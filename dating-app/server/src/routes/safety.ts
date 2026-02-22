import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getDb } from '../models/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

const reportSchema = z.object({
  reportedUserId: z.string().uuid(),
  reason: z.enum(['inappropriate_photos', 'harassment', 'spam', 'fake_profile', 'underage', 'other']),
  description: z.string().max(1000).optional(),
});

// POST /api/safety/block - Block a user
router.post('/block', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = req.userId!;
    const { blockedUserId } = req.body;

    if (!blockedUserId) {
      res.status(400).json({ error: 'blockedUserId is required' });
      return;
    }

    if (blockedUserId === userId) {
      res.status(400).json({ error: 'Cannot block yourself' });
      return;
    }

    const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(blockedUserId);
    if (!targetUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const blockAction = db.transaction(() => {
      // Create block record
      const blockId = uuidv4();
      db.prepare(
        'INSERT OR IGNORE INTO blocks (id, blocker_id, blocked_id) VALUES (?, ?, ?)'
      ).run(blockId, userId, blockedUserId);

      // Deactivate any existing match
      db.prepare(`
        UPDATE matches SET is_active = 0
        WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)
      `).run(userId, blockedUserId, blockedUserId, userId);
    });
    blockAction();

    res.json({ message: 'User blocked successfully' });
  } catch (err) {
    console.error('Block error:', err);
    res.status(500).json({ error: 'Failed to block user' });
  }
});

// DELETE /api/safety/block/:userId - Unblock a user
router.delete('/block/:userId', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
      .run(req.userId, req.params.userId);
    res.json({ message: 'User unblocked' });
  } catch (err) {
    console.error('Unblock error:', err);
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

// GET /api/safety/blocked - Get blocked users list
router.get('/blocked', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const blocked = db.prepare(`
      SELECT b.blocked_id, p.display_name, ph.url as photo_url, b.created_at
      FROM blocks b
      JOIN profiles p ON b.blocked_id = p.user_id
      LEFT JOIN photos ph ON b.blocked_id = ph.user_id AND ph.is_primary = 1
      WHERE b.blocker_id = ?
      ORDER BY b.created_at DESC
    `).all(req.userId) as any[];

    res.json({
      blockedUsers: blocked.map((b) => ({
        userId: b.blocked_id,
        displayName: b.display_name,
        photoUrl: b.photo_url,
        blockedAt: b.created_at,
      })),
    });
  } catch (err) {
    console.error('Get blocked error:', err);
    res.status(500).json({ error: 'Failed to get blocked users' });
  }
});

// POST /api/safety/report - Report a user
router.post('/report', authenticateToken, validate(reportSchema), (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = req.userId!;
    const { reportedUserId, reason, description } = req.body;

    if (reportedUserId === userId) {
      res.status(400).json({ error: 'Cannot report yourself' });
      return;
    }

    const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(reportedUserId);
    if (!targetUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Check for duplicate reports
    const existing = db.prepare(
      "SELECT id FROM reports WHERE reporter_id = ? AND reported_id = ? AND status = 'pending'"
    ).get(userId, reportedUserId);
    if (existing) {
      res.status(409).json({ error: 'You have already reported this user' });
      return;
    }

    const reportId = uuidv4();
    db.prepare(
      'INSERT INTO reports (id, reporter_id, reported_id, reason, description) VALUES (?, ?, ?, ?, ?)'
    ).run(reportId, userId, reportedUserId, reason, description || '');

    res.status(201).json({
      message: 'Report submitted. Our team will review it.',
      reportId,
    });
  } catch (err) {
    console.error('Report error:', err);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

// GET /api/safety/notifications - Get user notifications
router.get('/notifications', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    const notifications = db.prepare(`
      SELECT id, type, title, body, reference_id, is_read, created_at
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(req.userId, limit) as any[];

    const unreadCount = db.prepare(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
    ).get(req.userId) as any;

    res.json({
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        referenceId: n.reference_id,
        isRead: !!n.is_read,
        createdAt: n.created_at,
      })),
      unreadCount: unreadCount.count,
    });
  } catch (err) {
    console.error('Get notifications error:', err);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

// PUT /api/safety/notifications/read - Mark all notifications as read
router.put('/notifications/read', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0')
      .run(req.userId);
    res.json({ message: 'Notifications marked as read' });
  } catch (err) {
    console.error('Mark notifications read error:', err);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

// DELETE /api/safety/account - Deactivate account
router.delete('/account', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(req.userId);
    res.json({ message: 'Account deactivated. You can reactivate by logging in again.' });
  } catch (err) {
    console.error('Deactivate error:', err);
    res.status(500).json({ error: 'Failed to deactivate account' });
  }
});

export default router;
