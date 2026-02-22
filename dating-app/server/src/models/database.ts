import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'spark.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function initializeDatabase(): void {
  const db = getDb();

  db.exec(`
    -- Users table: core account information
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      phone TEXT,
      email_verified INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      is_premium INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_active TEXT DEFAULT (datetime('now'))
    );

    -- Profiles table: user-facing profile information
    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      age INTEGER NOT NULL CHECK(age >= 18 AND age <= 120),
      gender TEXT NOT NULL CHECK(gender IN ('male', 'female', 'non-binary', 'other')),
      bio TEXT DEFAULT '',
      location_city TEXT DEFAULT '',
      location_state TEXT DEFAULT '',
      location_lat REAL,
      location_lng REAL,
      looking_for TEXT DEFAULT 'relationship',
      occupation TEXT DEFAULT '',
      education TEXT DEFAULT '',
      height_cm INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Photos table: user profile photos
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      is_primary INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Interests table: user interests/hobbies
    CREATE TABLE IF NOT EXISTS interests (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      category TEXT DEFAULT 'general'
    );

    -- User-Interest junction table
    CREATE TABLE IF NOT EXISTS user_interests (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      interest_id TEXT NOT NULL REFERENCES interests(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, interest_id)
    );

    -- Preferences table: what a user is looking for
    CREATE TABLE IF NOT EXISTS preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      min_age INTEGER DEFAULT 18,
      max_age INTEGER DEFAULT 99,
      preferred_gender TEXT DEFAULT 'any',
      max_distance_km INTEGER DEFAULT 100,
      looking_for TEXT DEFAULT 'relationship'
    );

    -- Swipes table: track user swipe actions
    CREATE TABLE IF NOT EXISTS swipes (
      id TEXT PRIMARY KEY,
      swiper_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      swiped_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK(direction IN ('like', 'pass', 'superlike')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(swiper_id, swiped_id)
    );

    -- Matches table: mutual likes
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      user1_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user2_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      matched_at TEXT DEFAULT (datetime('now')),
      is_active INTEGER DEFAULT 1,
      UNIQUE(user1_id, user2_id)
    );

    -- Messages table: conversation messages
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      message_type TEXT DEFAULT 'text' CHECK(message_type IN ('text', 'image', 'gif', 'system')),
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Blocks table: user blocking
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(blocker_id, blocked_id)
    );

    -- Reports table: user reports for moderation
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reported_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL CHECK(reason IN ('inappropriate_photos', 'harassment', 'spam', 'fake_profile', 'underage', 'other')),
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT
    );

    -- Notifications table
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('match', 'message', 'like', 'superlike', 'system')),
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      reference_id TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_profiles_gender ON profiles(gender);
    CREATE INDEX IF NOT EXISTS idx_profiles_age ON profiles(age);
    CREATE INDEX IF NOT EXISTS idx_profiles_location ON profiles(location_lat, location_lng);
    CREATE INDEX IF NOT EXISTS idx_swipes_swiper ON swipes(swiper_id);
    CREATE INDEX IF NOT EXISTS idx_swipes_swiped ON swipes(swiped_id);
    CREATE INDEX IF NOT EXISTS idx_matches_user1 ON matches(user1_id);
    CREATE INDEX IF NOT EXISTS idx_matches_user2 ON matches(user2_id);
    CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);
    CREATE INDEX IF NOT EXISTS idx_photos_user ON photos(user_id);
  `);

  // Seed default interests
  const insertInterest = db.prepare(
    'INSERT OR IGNORE INTO interests (id, name, category) VALUES (?, ?, ?)'
  );

  const defaultInterests = [
    ['int_1', 'Travel', 'lifestyle'],
    ['int_2', 'Music', 'entertainment'],
    ['int_3', 'Movies', 'entertainment'],
    ['int_4', 'Reading', 'lifestyle'],
    ['int_5', 'Cooking', 'lifestyle'],
    ['int_6', 'Fitness', 'health'],
    ['int_7', 'Yoga', 'health'],
    ['int_8', 'Photography', 'creative'],
    ['int_9', 'Art', 'creative'],
    ['int_10', 'Gaming', 'entertainment'],
    ['int_11', 'Hiking', 'outdoors'],
    ['int_12', 'Camping', 'outdoors'],
    ['int_13', 'Dancing', 'entertainment'],
    ['int_14', 'Coffee', 'food'],
    ['int_15', 'Wine', 'food'],
    ['int_16', 'Pets', 'lifestyle'],
    ['int_17', 'Sports', 'health'],
    ['int_18', 'Technology', 'professional'],
    ['int_19', 'Startups', 'professional'],
    ['int_20', 'Volunteering', 'lifestyle'],
    ['int_21', 'Fashion', 'lifestyle'],
    ['int_22', 'Meditation', 'health'],
    ['int_23', 'Writing', 'creative'],
    ['int_24', 'Comedy', 'entertainment'],
    ['int_25', 'Surfing', 'outdoors'],
    ['int_26', 'Skiing', 'outdoors'],
    ['int_27', 'Board Games', 'entertainment'],
    ['int_28', 'Gardening', 'lifestyle'],
    ['int_29', 'Astronomy', 'science'],
    ['int_30', 'Languages', 'education'],
  ];

  const insertMany = db.transaction(() => {
    for (const [id, name, category] of defaultInterests) {
      insertInterest.run(id, name, category);
    }
  });
  insertMany();

  console.log('Database initialized successfully');
}
