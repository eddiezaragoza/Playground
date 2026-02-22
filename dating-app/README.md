# Spark - Dating Application

A full-stack dating application built with React, Node.js, Express, and SQLite.

## Tech Stack

**Frontend:** React 18, TypeScript, Vite, React Router, Socket.io Client
**Backend:** Node.js, Express, TypeScript, SQLite (better-sqlite3), Socket.io, JWT
**Real-time:** WebSocket via Socket.io for live messaging and typing indicators

## Features

### Core
- User registration and authentication (JWT-based)
- Profile creation with photos, bio, interests, and preferences
- Discovery feed with swipe-based matching (like, pass, super like)
- Compatibility scoring based on shared interests
- Real-time messaging with typing indicators and read receipts
- Match notifications

### Safety & Moderation
- User blocking and unblocking
- Report system with categorized reasons
- Content moderation infrastructure
- Account deactivation
- Age verification (18+ requirement)

### Profile
- Up to 6 photo uploads (JPEG, PNG, WebP)
- Bio, occupation, education, height, location
- 30 pre-defined interests across categories
- Configurable dating preferences (age range, gender, distance, relationship type)

## Project Structure

```
dating-app/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # React components
│   │   │   ├── auth/       # Login, Register
│   │   │   ├── common/     # AppShell, navigation
│   │   │   ├── discovery/  # Swipe interface
│   │   │   ├── messaging/  # Matches list, Chat
│   │   │   ├── profile/    # Profile view, Edit profile
│   │   │   └── settings/   # Settings, preferences
│   │   ├── hooks/          # Custom React hooks
│   │   ├── services/       # API and Socket clients
│   │   ├── styles/         # Global CSS
│   │   └── types/          # TypeScript interfaces
│   └── package.json
├── server/                 # Express backend
│   ├── src/
│   │   ├── middleware/     # Auth, upload, validation
│   │   ├── models/         # Database schema and init
│   │   ├── routes/         # API route handlers
│   │   ├── services/       # WebSocket service
│   │   ├── utils/          # Configuration
│   │   └── index.ts        # Server entry point
│   └── package.json
└── package.json            # Root scripts
```

## Getting Started

### Prerequisites
- Node.js 18+
- npm

### Installation

```bash
cd dating-app

# Install all dependencies
cd server && npm install
cd ../client && npm install
cd ..
```

### Development

Run both server and client in development mode:

```bash
# Terminal 1 - Start server
cd server && npm run dev

# Terminal 2 - Start client
cd client && npm run dev
```

- Client runs on http://localhost:3000
- Server runs on http://localhost:3001
- Vite proxies API and WebSocket requests to the server

### Production Build

```bash
# Build client
cd client && npm run build

# Build server
cd server && npm run build

# Start production server
NODE_ENV=production node server/dist/index.js
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Sign in
- `GET /api/auth/me` - Get current user

### Profile
- `PUT /api/profile` - Update profile
- `PUT /api/profile/preferences` - Update preferences
- `POST /api/profile/photos` - Upload photo
- `DELETE /api/profile/photos/:id` - Delete photo
- `PUT /api/profile/photos/:id/primary` - Set primary photo
- `GET /api/profile/interests` - List available interests

### Discovery
- `GET /api/discover` - Get potential matches
- `POST /api/discover/swipe` - Swipe on a profile

### Matches
- `GET /api/matches` - List matches
- `DELETE /api/matches/:id` - Unmatch

### Messages
- `GET /api/messages/:matchId` - Get messages
- `POST /api/messages/:matchId` - Send message

### Safety
- `POST /api/safety/block` - Block user
- `DELETE /api/safety/block/:userId` - Unblock
- `GET /api/safety/blocked` - List blocked users
- `POST /api/safety/report` - Report user
- `GET /api/safety/notifications` - Get notifications
- `PUT /api/safety/notifications/read` - Mark read
- `DELETE /api/safety/account` - Deactivate account

## WebSocket Events

### Client -> Server
- `send_message` - Send a chat message
- `typing_start` - Start typing indicator
- `typing_stop` - Stop typing indicator
- `mark_read` - Mark messages as read

### Server -> Client
- `new_message` - New message received
- `typing_start` / `typing_stop` - Typing indicators
- `messages_read` - Read receipts
- `user_status` - Online/offline status
