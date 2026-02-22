import { Router, Response } from 'express';
import { getDb } from '../models/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/matches - Get all matches for the current user
router.get('/', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = req.userId!;

    const matches = db.prepare(`
      SELECT
        m.id as match_id,
        m.matched_at,
        m.is_active,
        CASE WHEN m.user1_id = ? THEN m.user2_id ELSE m.user1_id END as other_user_id
      FROM matches m
      WHERE (m.user1_id = ? OR m.user2_id = ?)
        AND m.is_active = 1
      ORDER BY m.matched_at DESC
    `).all(userId, userId, userId) as any[];

    const enrichedMatches = matches.map((match) => {
      const profile = db.prepare(`
        SELECT p.display_name, p.age, p.gender, p.bio, p.location_city, p.occupation,
               u.last_active
        FROM profiles p JOIN users u ON p.user_id = u.id
        WHERE p.user_id = ?
      `).get(match.other_user_id) as any;

      const primaryPhoto = db.prepare(
        'SELECT url FROM photos WHERE user_id = ? AND is_primary = 1 LIMIT 1'
      ).get(match.other_user_id) as any;

      const lastMessage = db.prepare(`
        SELECT content, sender_id, created_at, is_read
        FROM messages WHERE match_id = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(match.match_id) as any;

      const unreadCount = db.prepare(`
        SELECT COUNT(*) as count FROM messages
        WHERE match_id = ? AND sender_id != ? AND is_read = 0
      `).get(match.match_id, userId) as any;

      return {
        matchId: match.match_id,
        matchedAt: match.matched_at,
        user: {
          id: match.other_user_id,
          displayName: profile?.display_name || 'Unknown',
          age: profile?.age,
          gender: profile?.gender,
          bio: profile?.bio || '',
          locationCity: profile?.location_city || '',
          occupation: profile?.occupation || '',
          photoUrl: primaryPhoto?.url || null,
          lastActive: profile?.last_active,
        },
        lastMessage: lastMessage ? {
          content: lastMessage.content,
          isOwn: lastMessage.sender_id === userId,
          createdAt: lastMessage.created_at,
          isRead: !!lastMessage.is_read,
        } : null,
        unreadCount: unreadCount?.count || 0,
      };
    });

    res.json({ matches: enrichedMatches });
  } catch (err) {
    console.error('Get matches error:', err);
    res.status(500).json({ error: 'Failed to get matches' });
  }
});

// DELETE /api/matches/:matchId - Unmatch (deactivate a match)
router.delete('/:matchId', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = req.userId!;

    const match = db.prepare(
      'SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?)'
    ).get(req.params.matchId, userId, userId) as any;

    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    db.prepare('UPDATE matches SET is_active = 0 WHERE id = ?').run(req.params.matchId);
    res.json({ message: 'Unmatched successfully' });
  } catch (err) {
    console.error('Unmatch error:', err);
    res.status(500).json({ error: 'Failed to unmatch' });
  }
});

export default router;
