/**
 * StudyBuddy Backend Server
 * Securely proxies Ollama Cloud calls for tutor and document-powered AI features.
 *
 * SETUP:
 * 1. npm install
 * 2. Create .env with ADMIN_USERNAME, ADMIN_PASSWORD_HASH, SESSION_SECRET, OLLAMA_API_KEY, and DATABASE_URL configured
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
const { callOllama } = require('../services/ollama');
const prompts = require('../config/prompts');
const { pool, query: dbQuery, transaction: dbTransaction } = require('../../db/pool');
const { calculateSm2, qualityForScore } = require('../services/sm2');
const {
  callOllamaJson, getDocumentMessages, getReferenceLabel, malformedJsonError, modelJsonError,
  parseJsonText, parseNotesResponse, sendAiError, validateDocument, validateReferences
} = require('../services/ai-content');
const {
  CARD_SELECT, findOrCreateDeck, normalizeCardText, normalizeDeckName, validateCardInput
} = require('../services/cards');
const { databaseFailure } = require('../services/database-errors');
const { requireAuth, requireJsonCsrf } = require('../middleware/request');
const { createAuthRouter } = require('../routes/auth');
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
  const forwarded = Array.isArray(req.headers['x-forwarded-for'])
    ? req.headers['x-forwarded-for'][0]
    : req.headers['x-forwarded-for'];
  const candidate = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
  const ip = candidate || req.ip || 'unknown';
  return ipKeyGenerator(ip);
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
app.use('/api', aiLimiter, requireAuth);

const routeContext = {
  callOllama, prompts, validateReferences, getReferenceLabel, sendAiError, callOllamaJson,
  modelJsonError, normalizeCardText, validateDocument, parseNotesResponse, getDocumentMessages,
  parseJsonText, malformedJsonError, dbQuery, dbTransaction, databaseFailure, normalizeDeckName,
  validateCardInput, findOrCreateDeck, CARD_SELECT, calculateSm2, qualityForScore
};
app.use(createAiRouter(routeContext));
app.use(createCardsRouter(routeContext));
app.use(createReviewRouter(routeContext));

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

module.exports = app;
