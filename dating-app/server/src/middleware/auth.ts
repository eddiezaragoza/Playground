import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../utils/config';
import { getDb } from '../models/database';

export interface AuthRequest extends Request {
  userId?: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;

    // Verify user still exists and is active
    const db = getDb();
    const user = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(decoded.userId) as any;

    if (!user || !user.is_active) {
      res.status(401).json({ error: 'Account not found or deactivated' });
      return;
    }

    // Update last active timestamp
    db.prepare('UPDATE users SET last_active = datetime(\'now\') WHERE id = ?').run(decoded.userId);

    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
}

export function generateToken(userId: string, email: string): string {
  return jwt.sign({ userId, email } as JwtPayload, config.jwtSecret, {
    expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
  });
}
