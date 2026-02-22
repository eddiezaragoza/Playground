import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../models/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/discover - Get potential matches
router.get('/', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = req.userId!;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const offset = parseInt(req.query.offset as string) || 0;

    // Get user's preferences
    const prefs = db.prepare('SELECT * FROM preferences WHERE user_id = ?').get(userId) as any;
    if (!prefs) {
      res.status(400).json({ error: 'Please set up your preferences first' });
      return;
    }

    // Build discovery query - exclude:
    // 1. The user themselves
    // 2. Users they've already swiped on
    // 3. Users who blocked them or they blocked
    // 4. Inactive users
    // Filter by preferences (age, gender)
    let genderFilter = '';
    if (prefs.preferred_gender !== 'any') {
      genderFilter = `AND p.gender = '${prefs.preferred_gender}'`;
    }

    const profiles = db.prepare(`
      SELECT
        u.id,
        p.display_name,
        p.age,
        p.gender,
        p.bio,
        p.location_city,
        p.location_state,
        p.occupation,
        p.education,
        p.height_cm,
        p.looking_for,
        u.last_active,
        u.is_premium
      FROM users u
      JOIN profiles p ON u.id = p.user_id
      WHERE u.id != ?
        AND u.is_active = 1
        AND p.age BETWEEN ? AND ?
        ${genderFilter}
        AND u.id NOT IN (SELECT swiped_id FROM swipes WHERE swiper_id = ?)
        AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
        AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
      ORDER BY
        CASE WHEN u.is_premium = 1 THEN 0 ELSE 1 END,
        u.last_active DESC
      LIMIT ? OFFSET ?
    `).all(
      userId,
      prefs.min_age, prefs.max_age,
      userId,
      userId,
      userId,
      limit, offset
    ) as any[];

    // Enrich profiles with photos and interests
    const enrichedProfiles = profiles.map((profile) => {
      const photos = db.prepare(
        'SELECT id, url, is_primary FROM photos WHERE user_id = ? ORDER BY sort_order'
      ).all(profile.id) as any[];

      const interests = db.prepare(`
        SELECT i.id, i.name, i.category
        FROM interests i JOIN user_interests ui ON i.id = ui.interest_id
        WHERE ui.user_id = ?
      `).all(profile.id) as any[];

      // Calculate compatibility score
      const userInterests = db.prepare(
        'SELECT interest_id FROM user_interests WHERE user_id = ?'
      ).all(userId) as any[];
      const userInterestIds = new Set(userInterests.map((ui: any) => ui.interest_id));
      const sharedInterests = interests.filter((i: any) => userInterestIds.has(i.id));
      const compatibilityScore = userInterestIds.size > 0
        ? Math.round((sharedInterests.length / Math.max(userInterestIds.size, interests.length)) * 100)
        : 0;

      return {
        id: profile.id,
        displayName: profile.display_name,
        age: profile.age,
        gender: profile.gender,
        bio: profile.bio || '',
        locationCity: profile.location_city || '',
        locationState: profile.location_state || '',
        occupation: profile.occupation || '',
        education: profile.education || '',
        heightCm: profile.height_cm,
        lookingFor: profile.looking_for,
        photos,
        interests,
        sharedInterests,
        compatibilityScore,
        lastActive: profile.last_active,
      };
    });

    res.json({
      profiles: enrichedProfiles,
      hasMore: profiles.length === limit,
    });
  } catch (err) {
    console.error('Discovery error:', err);
    res.status(500).json({ error: 'Failed to load profiles' });
  }
});

// POST /api/discover/swipe - Swipe on a profile
router.post('/swipe', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = req.userId!;
    const { targetUserId, direction } = req.body;

    if (!targetUserId || !['like', 'pass', 'superlike'].includes(direction)) {
      res.status(400).json({ error: 'Invalid swipe data' });
      return;
    }

    // Check if target user exists
    const targetUser = db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(targetUserId);
    if (!targetUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Check daily swipe limit (for non-premium users)
    const user = db.prepare('SELECT is_premium FROM users WHERE id = ?').get(userId) as any;
    if (!user.is_premium) {
      const todaySwipes = db.prepare(`
        SELECT COUNT(*) as count FROM swipes
        WHERE swiper_id = ? AND created_at >= date('now')
      `).get(userId) as any;

      if (todaySwipes.count >= 100) {
        res.status(429).json({ error: 'Daily swipe limit reached. Upgrade to premium for unlimited swipes!' });
        return;
      }

      if (direction === 'superlike') {
        const todaySuperlikes = db.prepare(`
          SELECT COUNT(*) as count FROM swipes
          WHERE swiper_id = ? AND direction = 'superlike' AND created_at >= date('now')
        `).get(userId) as any;
        if (todaySuperlikes.count >= 5) {
          res.status(429).json({ error: 'Daily super like limit reached' });
          return;
        }
      }
    }

    // Record the swipe
    const swipeId = uuidv4();
    db.prepare(
      'INSERT OR REPLACE INTO swipes (id, swiper_id, swiped_id, direction) VALUES (?, ?, ?, ?)'
    ).run(swipeId, userId, targetUserId, direction);

    let isMatch = false;
    let matchId: string | null = null;

    // Check for mutual like (match)
    if (direction === 'like' || direction === 'superlike') {
      const reciprocal = db.prepare(`
        SELECT id FROM swipes
        WHERE swiper_id = ? AND swiped_id = ? AND direction IN ('like', 'superlike')
      `).get(targetUserId, userId) as any;

      if (reciprocal) {
        // It's a match!
        isMatch = true;
        matchId = uuidv4();

        const createMatch = db.transaction(() => {
          // Order user IDs consistently
          const [u1, u2] = [userId, targetUserId].sort();
          db.prepare(
            'INSERT OR IGNORE INTO matches (id, user1_id, user2_id) VALUES (?, ?, ?)'
          ).run(matchId, u1, u2);

          // Create notifications for both users
          const notifId1 = uuidv4();
          const notifId2 = uuidv4();
          const swiperName = (db.prepare('SELECT display_name FROM profiles WHERE user_id = ?').get(userId) as any).display_name;
          const targetName = (db.prepare('SELECT display_name FROM profiles WHERE user_id = ?').get(targetUserId) as any).display_name;

          db.prepare(
            'INSERT INTO notifications (id, user_id, type, title, body, reference_id) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(notifId1, userId, 'match', 'New Match!', `You and ${targetName} liked each other!`, matchId);

          db.prepare(
            'INSERT INTO notifications (id, user_id, type, title, body, reference_id) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(notifId2, targetUserId, 'match', 'New Match!', `You and ${swiperName} liked each other!`, matchId);
        });
        createMatch();
      }
    }

    res.json({
      swipe: { id: swipeId, direction },
      isMatch,
      matchId,
    });
  } catch (err) {
    console.error('Swipe error:', err);
    res.status(500).json({ error: 'Failed to process swipe' });
  }
});

export default router;
