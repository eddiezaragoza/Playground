import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../models/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { config } from '../utils/config';

const router = Router();

// GET /api/messages/:matchId - Get messages for a match
router.get('/:matchId', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = req.userId!;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const before = req.query.before as string;

    // Verify user is part of this match
    const match = db.prepare(
      'SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?) AND is_active = 1'
    ).get(req.params.matchId, userId, userId) as any;

    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    let query = `
      SELECT m.id, m.sender_id, m.content, m.message_type, m.is_read, m.created_at
      FROM messages m
      WHERE m.match_id = ?
    `;
    const params: any[] = [req.params.matchId];

    if (before) {
      query += ' AND m.created_at < ?';
      params.push(before);
    }

    query += ' ORDER BY m.created_at DESC LIMIT ?';
    params.push(limit);

    const messages = db.prepare(query).all(...params) as any[];

    // Mark messages from other user as read
    db.prepare(`
      UPDATE messages SET is_read = 1
      WHERE match_id = ? AND sender_id != ? AND is_read = 0
    `).run(req.params.matchId, userId);

    res.json({
      messages: messages.reverse().map((msg) => ({
        id: msg.id,
        senderId: msg.sender_id,
        content: msg.content,
        type: msg.message_type,
        isRead: !!msg.is_read,
        isOwn: msg.sender_id === userId,
        createdAt: msg.created_at,
      })),
      hasMore: messages.length === limit,
    });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// POST /api/messages/:matchId - Send a message
router.post('/:matchId', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const userId = req.userId!;
    const { content, type = 'text' } = req.body;

    if (!content || content.trim().length === 0) {
      res.status(400).json({ error: 'Message content is required' });
      return;
    }

    if (content.length > config.maxMessageLength) {
      res.status(400).json({ error: `Message exceeds maximum length of ${config.maxMessageLength} characters` });
      return;
    }

    // Verify user is part of this match
    const match = db.prepare(
      'SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?) AND is_active = 1'
    ).get(req.params.matchId, userId, userId) as any;

    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    const messageId = uuidv4();
    db.prepare(
      'INSERT INTO messages (id, match_id, sender_id, content, message_type) VALUES (?, ?, ?, ?, ?)'
    ).run(messageId, req.params.matchId, userId, content.trim(), type);

    // Create notification for the recipient
    const recipientId = match.user1_id === userId ? match.user2_id : match.user1_id;
    const senderProfile = db.prepare('SELECT display_name FROM profiles WHERE user_id = ?').get(userId) as any;

    const notifId = uuidv4();
    db.prepare(
      'INSERT INTO notifications (id, user_id, type, title, body, reference_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(notifId, recipientId, 'message', 'New Message', `${senderProfile.display_name}: ${content.substring(0, 50)}`, req.params.matchId);

    const message = {
      id: messageId,
      matchId: req.params.matchId,
      senderId: userId,
      content: content.trim(),
      type,
      isRead: false,
      isOwn: true,
      createdAt: new Date().toISOString(),
    };

    res.status(201).json({ message });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
