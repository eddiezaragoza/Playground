import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getDb } from '../models/database';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { uploadPhoto } from '../middleware/upload';
import { validate } from '../middleware/validate';
import { config } from '../utils/config';
import fs from 'fs';
import path from 'path';

const router = Router();

const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(50).optional(),
  bio: z.string().max(config.maxBioLength).optional(),
  locationCity: z.string().max(100).optional(),
  locationState: z.string().max(100).optional(),
  occupation: z.string().max(100).optional(),
  education: z.string().max(100).optional(),
  heightCm: z.number().int().min(100).max(250).optional().nullable(),
  lookingFor: z.enum(['relationship', 'casual', 'friendship', 'not-sure']).optional(),
  interests: z.array(z.string()).max(10).optional(),
});

const updatePreferencesSchema = z.object({
  minAge: z.number().int().min(18).max(99).optional(),
  maxAge: z.number().int().min(18).max(99).optional(),
  preferredGender: z.enum(['male', 'female', 'non-binary', 'any']).optional(),
  maxDistanceKm: z.number().int().min(1).max(500).optional(),
  lookingFor: z.enum(['relationship', 'casual', 'friendship', 'not-sure', 'any']).optional(),
});

// PUT /api/profile - Update user profile
router.put('/', authenticateToken, validate(updateProfileSchema), (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { displayName, bio, locationCity, locationState, occupation, education, heightCm, lookingFor, interests } = req.body;

    const updates: string[] = [];
    const values: any[] = [];

    if (displayName !== undefined) { updates.push('display_name = ?'); values.push(displayName); }
    if (bio !== undefined) { updates.push('bio = ?'); values.push(bio); }
    if (locationCity !== undefined) { updates.push('location_city = ?'); values.push(locationCity); }
    if (locationState !== undefined) { updates.push('location_state = ?'); values.push(locationState); }
    if (occupation !== undefined) { updates.push('occupation = ?'); values.push(occupation); }
    if (education !== undefined) { updates.push('education = ?'); values.push(education); }
    if (heightCm !== undefined) { updates.push('height_cm = ?'); values.push(heightCm); }
    if (lookingFor !== undefined) { updates.push('looking_for = ?'); values.push(lookingFor); }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now')");
      values.push(req.userId);
      db.prepare(`UPDATE profiles SET ${updates.join(', ')} WHERE user_id = ?`).run(...values);
    }

    // Update interests if provided
    if (interests) {
      const updateInterests = db.transaction(() => {
        db.prepare('DELETE FROM user_interests WHERE user_id = ?').run(req.userId);
        const insert = db.prepare('INSERT OR IGNORE INTO user_interests (user_id, interest_id) VALUES (?, ?)');
        for (const interestId of interests) {
          insert.run(req.userId, interestId);
        }
      });
      updateInterests();
    }

    // Fetch updated profile
    const profile = db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM photos WHERE user_id = p.user_id) as photo_count
      FROM profiles p WHERE p.user_id = ?
    `).get(req.userId) as any;

    const userInterests = db.prepare(`
      SELECT i.id, i.name, i.category
      FROM interests i JOIN user_interests ui ON i.id = ui.interest_id
      WHERE ui.user_id = ?
    `).all(req.userId);

    res.json({
      profile: {
        displayName: profile.display_name,
        age: profile.age,
        gender: profile.gender,
        bio: profile.bio,
        locationCity: profile.location_city,
        locationState: profile.location_state,
        occupation: profile.occupation,
        education: profile.education,
        heightCm: profile.height_cm,
        lookingFor: profile.looking_for,
        interests: userInterests,
        profileComplete: profile.photo_count > 0,
      },
    });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// PUT /api/profile/preferences - Update dating preferences
router.put('/preferences', authenticateToken, validate(updatePreferencesSchema), (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const { minAge, maxAge, preferredGender, maxDistanceKm, lookingFor } = req.body;

    const updates: string[] = [];
    const values: any[] = [];

    if (minAge !== undefined) { updates.push('min_age = ?'); values.push(minAge); }
    if (maxAge !== undefined) { updates.push('max_age = ?'); values.push(maxAge); }
    if (preferredGender !== undefined) { updates.push('preferred_gender = ?'); values.push(preferredGender); }
    if (maxDistanceKm !== undefined) { updates.push('max_distance_km = ?'); values.push(maxDistanceKm); }
    if (lookingFor !== undefined) { updates.push('looking_for = ?'); values.push(lookingFor); }

    if (updates.length > 0) {
      values.push(req.userId);
      db.prepare(`UPDATE preferences SET ${updates.join(', ')} WHERE user_id = ?`).run(...values);
    }

    const preferences = db.prepare('SELECT * FROM preferences WHERE user_id = ?').get(req.userId) as any;

    res.json({
      preferences: {
        minAge: preferences.min_age,
        maxAge: preferences.max_age,
        preferredGender: preferences.preferred_gender,
        maxDistanceKm: preferences.max_distance_km,
        lookingFor: preferences.looking_for,
      },
    });
  } catch (err) {
    console.error('Update preferences error:', err);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// POST /api/profile/photos - Upload a photo
router.post('/photos', authenticateToken, uploadPhoto.single('photo'), (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No photo provided' });
      return;
    }

    const db = getDb();

    // Check photo limit
    const photoCount = db.prepare('SELECT COUNT(*) as count FROM photos WHERE user_id = ?').get(req.userId) as any;
    if (photoCount.count >= config.maxPhotos) {
      // Remove the uploaded file
      fs.unlinkSync(req.file.path);
      res.status(400).json({ error: `Maximum of ${config.maxPhotos} photos allowed` });
      return;
    }

    const photoId = uuidv4();
    const url = `/uploads/photos/${req.file.filename}`;
    const isPrimary = photoCount.count === 0 ? 1 : 0;

    db.prepare(
      'INSERT INTO photos (id, user_id, filename, url, is_primary, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(photoId, req.userId, req.file.filename, url, isPrimary, photoCount.count);

    res.status(201).json({
      photo: {
        id: photoId,
        url,
        isPrimary: !!isPrimary,
        sortOrder: photoCount.count,
      },
    });
  } catch (err) {
    console.error('Photo upload error:', err);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

// DELETE /api/profile/photos/:photoId - Delete a photo
router.delete('/photos/:photoId', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const photo = db.prepare('SELECT * FROM photos WHERE id = ? AND user_id = ?').get(req.params.photoId, req.userId) as any;

    if (!photo) {
      res.status(404).json({ error: 'Photo not found' });
      return;
    }

    // Delete file from disk
    const filePath = path.join(__dirname, '..', '..', 'uploads', 'photos', photo.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    db.prepare('DELETE FROM photos WHERE id = ?').run(req.params.photoId);

    // If deleted photo was primary, make the next one primary
    if (photo.is_primary) {
      const nextPhoto = db.prepare('SELECT id FROM photos WHERE user_id = ? ORDER BY sort_order LIMIT 1').get(req.userId) as any;
      if (nextPhoto) {
        db.prepare('UPDATE photos SET is_primary = 1 WHERE id = ?').run(nextPhoto.id);
      }
    }

    res.json({ message: 'Photo deleted' });
  } catch (err) {
    console.error('Delete photo error:', err);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

// PUT /api/profile/photos/:photoId/primary - Set photo as primary
router.put('/photos/:photoId/primary', authenticateToken, (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const photo = db.prepare('SELECT * FROM photos WHERE id = ? AND user_id = ?').get(req.params.photoId, req.userId) as any;

    if (!photo) {
      res.status(404).json({ error: 'Photo not found' });
      return;
    }

    const setPrimary = db.transaction(() => {
      db.prepare('UPDATE photos SET is_primary = 0 WHERE user_id = ?').run(req.userId);
      db.prepare('UPDATE photos SET is_primary = 1 WHERE id = ?').run(req.params.photoId);
    });
    setPrimary();

    res.json({ message: 'Primary photo updated' });
  } catch (err) {
    console.error('Set primary photo error:', err);
    res.status(500).json({ error: 'Failed to set primary photo' });
  }
});

// GET /api/profile/interests - Get all available interests
router.get('/interests', (req: AuthRequest, res: Response) => {
  try {
    const db = getDb();
    const interests = db.prepare('SELECT id, name, category FROM interests ORDER BY category, name').all();
    res.json({ interests });
  } catch (err) {
    console.error('Get interests error:', err);
    res.status(500).json({ error: 'Failed to get interests' });
  }
});

export default router;
