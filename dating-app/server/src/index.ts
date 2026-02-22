import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import path from 'path';
import { config } from './utils/config';
import { initializeDatabase } from './models/database';
import { initializeSocket } from './services/socket';

// Import routes
import authRoutes from './routes/auth';
import profileRoutes from './routes/profile';
import discoveryRoutes from './routes/discovery';
import matchRoutes from './routes/matches';
import messageRoutes from './routes/messages';
import safetyRoutes from './routes/safety';

const app = express();
const httpServer = createServer(app);

// Initialize database
initializeDatabase();

// Initialize WebSocket
const io = initializeSocket(httpServer);

// Middleware
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/discover', discoveryRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/safety', safetyRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', '..', 'client', 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'client', 'dist', 'index.html'));
  });
}

// Error handling middleware
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

httpServer.listen(config.port, () => {
  console.log(`
  ⚡ Spark Dating Server running on port ${config.port}
  📡 API: http://localhost:${config.port}/api
  🔌 WebSocket: ws://localhost:${config.port}
  `);
});

export { app, httpServer, io };
