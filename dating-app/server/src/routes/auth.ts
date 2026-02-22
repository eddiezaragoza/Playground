import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getDb } from '../models/database';
import { generateToken, authenticateToken, AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { config } from '../utils/config';

const router = Router();

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  displayName: z.string().min(2, 'Display name must be at least 2 characters').max(50),
  age: z.number().int().min(18, 'Must be at least 18 years old').max(120),
  gender: z.enum(['male', 'female', 'non-binary', 'other']),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// POST /api/auth/register
router.post('/register', validate(registerSchema), async (req: Request, res: Response) => {
  try {
    const { email, password, displayName, age, gender } = req.body;
    const db = getDb();

    // Check if email already exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);

    // Create user and profile in a transaction
    const createUser = db.transaction(() => {
      db.prepare(
        'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)'
      ).run(userId, email, passwordHash);

      db.prepare(
        'INSERT INTO profiles (user_id, display_name, age, gender) VALUES (?, ?, ?, ?)'
      ).run(userId, displayName, age, gender);

      db.prepare(
        'INSERT INTO preferences (user_id) VALUES (?)'
      ).run(userId);
    });

    createUser();

    const token = generateToken(userId, email);

    res.status(201).json({
      token,
      user: {
        id: userId,
        email,
        displayName,
        age,
        gender,
        profileComplete: false,
      },
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const db = getDb();

    const user = db.prepare(
      'SELECT u.id, u.email, u.password_hash, u.is_active, p.display_name, p.age, p.gender, p.bio FROM users u LEFT JOIN profiles p ON u.id = p.user_id WHERE u.email = ?'
    ).get(email) as any;

    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    if (!user.is_active) {
      res.status(403).json({ error: 'Account has been deactivated' });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Update last active
    db.prepare('UPDATE users SET last_active = datetime(\'now\') WHERE id = ?').run(user.id);

    const token = generateToken(user.id, user.email);

    // Check if profile has photos (profile completeness)
    const photoCount = db.prepare('SELECT COUNT(*) as count FROM photos WHERE user_id = ?').get(user.id) as any;

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        age: user.age,
        gender: user.gender,
        bio: user.bio,
        profileComplete: photoCount.count > 0,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me - Get current user info
router.get('/me', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const user = db.prepare(`
      SELECT u.id, u.email, u.is_premium, u.created_at,
             p.display_name, p.age, p.gender, p.bio, p.location_city,
             p.location_state, p.occupation, p.education, p.height_cm, p.looking_for
      FROM users u
      LEFT JOIN profiles p ON u.id = p.user_id
      WHERE u.id = ?
    `).get(req.userId) as any;

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const photos = db.prepare(
      'SELECT id, url, is_primary, sort_order FROM photos WHERE user_id = ? ORDER BY sort_order'
    ).all(req.userId) as any[];

    const interests = db.prepare(`
      SELECT i.id, i.name, i.category
      FROM interests i
      JOIN user_interests ui ON i.id = ui.interest_id
      WHERE ui.user_id = ?
    `).all(req.userId) as any[];

    const preferences = db.prepare(
      'SELECT * FROM preferences WHERE user_id = ?'
    ).get(req.userId) as any;

    res.json({
      user: {
        id: user.id,
        email: user.email,
        isPremium: !!user.is_premium,
        displayName: user.display_name,
        age: user.age,
        gender: user.gender,
        bio: user.bio || '',
        locationCity: user.location_city || '',
        locationState: user.location_state || '',
        occupation: user.occupation || '',
        education: user.education || '',
        heightCm: user.height_cm,
        lookingFor: user.looking_for || 'relationship',
        photos,
        interests,
        profileComplete: photos.length > 0,
        createdAt: user.created_at,
      },
      preferences: preferences ? {
        minAge: preferences.min_age,
        maxAge: preferences.max_age,
        preferredGender: preferences.preferred_gender,
        maxDistanceKm: preferences.max_distance_km,
        lookingFor: preferences.looking_for,
      } : null,
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

export default router;
