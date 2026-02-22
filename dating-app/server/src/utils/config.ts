export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  jwtSecret: process.env.JWT_SECRET || 'spark-dating-dev-secret-change-in-production',
  jwtExpiresIn: '7d',
  bcryptRounds: 12,
  maxPhotos: 6,
  maxPhotoSizeMB: 10,
  maxMessageLength: 2000,
  maxBioLength: 500,
  dailySwipeLimit: 100,
  dailySuperlikeLimit: 5,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
};
