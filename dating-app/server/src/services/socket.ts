import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../utils/config';
import { getDb } from '../models/database';
import { v4 as uuidv4 } from 'uuid';
import { JwtPayload } from '../middleware/auth';

// Track online users: userId -> socketId
const onlineUsers = new Map<string, string>();

export function initializeSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigin,
      methods: ['GET', 'POST'],
    },
  });

  // Authentication middleware for socket connections
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
      (socket as any).userId = decoded.userId;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket as any).userId as string;
    onlineUsers.set(userId, socket.id);

    console.log(`User connected: ${userId}`);

    // Join personal room for targeted messages
    socket.join(`user:${userId}`);

    // Notify matches that user is online
    broadcastOnlineStatus(io, userId, true);

    // Handle sending messages via WebSocket
    socket.on('send_message', (data: { matchId: string; content: string; type?: string }) => {
      try {
        const db = getDb();
        const { matchId, content, type = 'text' } = data;

        if (!content || content.trim().length === 0) return;
        if (content.length > config.maxMessageLength) return;

        // Verify user is part of this match
        const match = db.prepare(
          'SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?) AND is_active = 1'
        ).get(matchId, userId, userId) as any;

        if (!match) return;

        const messageId = uuidv4();
        db.prepare(
          'INSERT INTO messages (id, match_id, sender_id, content, message_type) VALUES (?, ?, ?, ?, ?)'
        ).run(messageId, matchId, userId, content.trim(), type);

        const recipientId = match.user1_id === userId ? match.user2_id : match.user1_id;

        const message = {
          id: messageId,
          matchId,
          senderId: userId,
          content: content.trim(),
          type,
          isRead: false,
          createdAt: new Date().toISOString(),
        };

        // Send to both users in the conversation
        io.to(`user:${userId}`).emit('new_message', { ...message, isOwn: true });
        io.to(`user:${recipientId}`).emit('new_message', { ...message, isOwn: false });

        // Create notification for recipient
        const senderProfile = db.prepare('SELECT display_name FROM profiles WHERE user_id = ?').get(userId) as any;
        const notifId = uuidv4();
        db.prepare(
          'INSERT INTO notifications (id, user_id, type, title, body, reference_id) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(notifId, recipientId, 'message', 'New Message', `${senderProfile.display_name}: ${content.substring(0, 50)}`, matchId);
      } catch (err) {
        console.error('Socket message error:', err);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle typing indicators
    socket.on('typing_start', (data: { matchId: string }) => {
      const db = getDb();
      const match = db.prepare(
        'SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?) AND is_active = 1'
      ).get(data.matchId, userId, userId) as any;

      if (match) {
        const recipientId = match.user1_id === userId ? match.user2_id : match.user1_id;
        io.to(`user:${recipientId}`).emit('typing_start', { matchId: data.matchId, userId });
      }
    });

    socket.on('typing_stop', (data: { matchId: string }) => {
      const db = getDb();
      const match = db.prepare(
        'SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?) AND is_active = 1'
      ).get(data.matchId, userId, userId) as any;

      if (match) {
        const recipientId = match.user1_id === userId ? match.user2_id : match.user1_id;
        io.to(`user:${recipientId}`).emit('typing_stop', { matchId: data.matchId, userId });
      }
    });

    // Handle marking messages as read
    socket.on('mark_read', (data: { matchId: string }) => {
      const db = getDb();
      db.prepare(`
        UPDATE messages SET is_read = 1
        WHERE match_id = ? AND sender_id != ? AND is_read = 0
      `).run(data.matchId, userId);

      // Notify the other user their messages were read
      const match = db.prepare(
        'SELECT * FROM matches WHERE id = ? AND (user1_id = ? OR user2_id = ?)'
      ).get(data.matchId, userId, userId) as any;

      if (match) {
        const recipientId = match.user1_id === userId ? match.user2_id : match.user1_id;
        io.to(`user:${recipientId}`).emit('messages_read', { matchId: data.matchId, readBy: userId });
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      onlineUsers.delete(userId);
      broadcastOnlineStatus(io, userId, false);
      console.log(`User disconnected: ${userId}`);
    });
  });

  return io;
}

function broadcastOnlineStatus(io: Server, userId: string, isOnline: boolean) {
  const db = getDb();
  // Get all active matches for this user
  const matches = db.prepare(`
    SELECT
      CASE WHEN user1_id = ? THEN user2_id ELSE user1_id END as other_user_id
    FROM matches
    WHERE (user1_id = ? OR user2_id = ?) AND is_active = 1
  `).all(userId, userId, userId) as any[];

  for (const match of matches) {
    io.to(`user:${match.other_user_id}`).emit('user_status', { userId, isOnline });
  }
}

export function isUserOnline(userId: string): boolean {
  return onlineUsers.has(userId);
}
