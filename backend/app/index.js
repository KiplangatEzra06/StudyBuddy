/**
 * StudyBuddy Backend Server
 * Securely proxies AI calls for tutor and document-powered AI features.
 *
 * SETUP:
 * 1. npm install
 * 2. Create .env with ADMIN_USERNAME, ADMIN_PASSWORD_HASH, SESSION_SECRET, AI_BASE_URL, AI_API_KEY, AI_MODEL, and DATABASE_URL configured
 * 3. npm start
 */

const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const helmet = require('helmet');
const connectPgSimple = require('connect-pg-simple');
const path = require('path');
const { pool } = require('../../db/pool');
const { requireAuth, requireJsonCsrf } = require('../middleware/request');
const { createAuthRouter } = require('../routes/auth');
const createAssignmentBriefRouter = require('../routes/assignment-briefs');
const createAiRouter = require('../routes/ai');
const createCardsRouter = require('../routes/cards');
const createReviewRouter = require('../routes/review');

const isProduction = process.env.NODE_ENV === 'production';
const requiredProductionSettings = ['ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET'];
const missingProductionSettings = requiredProductionSettings.filter(name => !process.env[name]);
if (isProduction && missingProductionSettings.length) {
  throw new Error(`Missing required production environment variables: ${missingProductionSettings.join(', ')}`);
}
if (isProduction && process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 characters in production.');
}
if (process.env.ADMIN_PASSWORD_HASH
  && !/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(process.env.ADMIN_PASSWORD_HASH)) {
  throw new Error('ADMIN_PASSWORD_HASH must be a valid bcrypt hash using cost 12.');
}

const app = express();

function limiterKey(req) {
  return ipKeyGenerator(req.ip || 'unknown');
}

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
      connectSrc: ["'self'"],
      workerSrc: ["'self'", 'blob:', 'https://cdnjs.cloudflare.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"]
    }
  }
}));
app.use(express.json({ limit: '10mb' }));
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: limiterKey,
  message: { error: 'Too many AI requests. Please try again in a minute.' }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: limiterKey,
  skipSuccessfulRequests: true,
  message: { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' }
});
const PgSessionStore = connectPgSimple(session);
const sessionStore = process.env.NODE_ENV === 'test'
  ? new session.MemoryStore()
  : new PgSessionStore({ pool, tableName: 'session', createTableIfMissing: false });
app.use(session({
  name: 'studybuddy.sid',
  store: sessionStore,
  secret: process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex'),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}));

const publicDirectory = path.join(__dirname, '../../public');
const frontendDirectory = path.join(__dirname, '../../frontend');

app.use('/api', requireJsonCsrf);
app.use('/api/auth', createAuthRouter({ loginLimiter, isProduction }));
const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: limiterKey,
  message: { error: 'Too many requests. Please try again in a minute.' }
});
app.use('/api', apiRateLimiter, requireAuth);
app.use('/api/ai', aiLimiter);
app.use('/api/cards/generate', aiLimiter);
app.use('/api/generate-notes', aiLimiter);
app.use('/api/generate-flashcards', aiLimiter);
app.use('/api/generate-quiz', aiLimiter);
app.use('/api/review/grade', aiLimiter);

app.use('/api/assignments', createAssignmentBriefRouter());
app.use(createAiRouter());
app.use(createCardsRouter());
app.use(createReviewRouter());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/frontend', express.static(frontendDirectory, {
  index: false,
  maxAge: '1d',
  setHeaders(res, filePath) {
    if (/\.(?:js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.use(express.static(publicDirectory, {
  index: 'index.html',
  maxAge: '1d',
  setHeaders(res, filePath) {
    const fileName = path.basename(filePath);
    if (fileName.toLowerCase() === 'index.html') {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    if (/(^|[.-])[a-f0-9]{8,}([.-]|$)/i.test(fileName)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }
    if (/\.(?:js|css|webmanifest)$/i.test(fileName)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.use((error, req, res, next) => {
  if (error && error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON request body.' });
  }
  if (res.headersSent) {
    return next(error);
  }
  const status = Number.isInteger(error?.status) && error.status >= 400 ? error.status : 500;
  console.error('Unhandled server error:', error);
  return res.status(status).json({ error: 'Something went wrong on the server.' });
});

module.exports = app;
