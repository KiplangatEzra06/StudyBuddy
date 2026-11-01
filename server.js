/**
 * StudyBuddy Backend Server
 * Securely proxies Ollama Cloud calls for tutor and document-powered AI features.
 *
 * SETUP:
 * 1. npm install
 * 2. Create .env with ADMIN_USERNAME, ADMIN_PASSWORD_HASH, SESSION_SECRET, OLLAMA_API_KEY, and DATABASE_URL configured
 * 3. npm start
 */

require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const connectPgSimple = require('connect-pg-simple');
const path = require('path');
const { callOllama } = require('./services/ollama');
const prompts = require('./config/prompts');
const { pool, query: dbQuery, transaction: dbTransaction } = require('./db/pool');
const { calculateSm2, qualityForScore } = require('./sm2');

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
const PORT = process.env.PORT || 3000;

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

function requireJsonCsrf(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Requests must use application/json.' });
  }
  if (req.get('X-Requested-With') !== 'StudyBuddy') {
    return res.status(403).json({ error: 'Request could not be verified.' });
  }
  next();
}

function requireAuth(req, res, next) {
  if (req.session?.authenticated === true) return next();
  return res.status(401).json({ error: 'Authentication required.' });
}

function usernamesMatchConstantTime(username) {
  const supplied = crypto.createHash('sha256').update(username).digest();
  const configured = crypto.createHash('sha256').update(process.env.ADMIN_USERNAME || '').digest();
  return crypto.timingSafeEqual(supplied, configured);
}

const unavailablePasswordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
const configuredPasswordHash = process.env.ADMIN_PASSWORD_HASH || unavailablePasswordHash;
const publicDirectory = path.join(__dirname, 'public');

app.use('/api', requireJsonCsrf);
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  let passwordMatches = false;
  try {
    passwordMatches = await bcrypt.compare(password, configuredPasswordHash);
  } catch {
    passwordMatches = false;
  }
  const usernameMatches = usernamesMatchConstantTime(username);
  const credentialsConfigured = Boolean(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD_HASH);
  if (!credentialsConfigured || !usernameMatches || !passwordMatches) {
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  req.session.regenerate(error => {
    if (error) {
      console.error('Could not establish authenticated session.');
      return res.status(500).json({ error: 'Could not sign in right now. Please try again.' });
    }
    req.session.authenticated = true;
    req.session.save(saveError => {
      if (saveError) {
        console.error('Could not save authenticated session.');
        return res.status(500).json({ error: 'Could not sign in right now. Please try again.' });
      }
      res.json({ authenticated: true });
    });
  });
});
app.post('/api/auth/logout', (req, res) => {
  if (!req.session) return res.sendStatus(204);
  req.session.destroy(error => {
    if (error) {
      console.error('Could not destroy authenticated session.');
      return res.status(500).json({ error: 'Could not log out right now. Please try again.' });
    }
    res.clearCookie('studybuddy.sid', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/'
    });
    res.sendStatus(204);
  });
});
app.get('/api/auth/me', (req, res) => {
  res.json({ authenticated: req.session?.authenticated === true });
});
app.use('/api', aiLimiter, requireAuth);

function parseJsonText(text) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[\[{]/);
    if (start < 0) throw malformedJsonError();
    const expectedClosers = [];
    let inString = false;
    let escaped = false;

    for (let index = start; index < trimmed.length; index++) {
      const character = trimmed[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') expectedClosers.push('}');
      else if (character === '[') expectedClosers.push(']');
      else if (character === '}' || character === ']') {
        if (expectedClosers.pop() !== character) throw malformedJsonError();
        if (expectedClosers.length === 0) {
          try {
            return JSON.parse(trimmed.slice(start, index + 1));
          } catch {
            throw malformedJsonError();
          }
        }
      }
    }
    throw malformedJsonError();
  }
}

function malformedJsonError() {
  const error = new Error('The AI returned malformed JSON. Please try again.');
  error.status = 502;
  return error;
}

function getDocumentMessages(prompt, document) {
  return [
    { role: 'system', content: prompt },
    {
      role: 'user',
      content: `Document title: ${document.title}\nCourse: ${document.course}\nUnit: ${document.unit}\n\nSource text:\n${document.text}`
    }
  ];
}

function sendAiError(res, error, fallback) {
  if (error.upstreamStatus) {
    return res.status(502).json({
      error: `Ollama rejected the request (upstream status: ${error.upstreamStatus})`
    });
  }
  const status = error.status || 502;
  const message = status === 502 && error.message.includes('malformed JSON')
    ? error.message
    : fallback;
  res.status(status).json({ error: message });
}

function modelJsonError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function callOllamaJson(messages, validate, failureMessage, operation) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = parseJsonText(await callOllama(messages, { format: 'json' }));
      return validate(parsed);
    } catch (error) {
      lastError = error;
      console.error(`Ollama ${operation} attempt failed`, {
        attempt,
        status: error.status || 0,
        code: error.code || 'unknown'
      });
    }
  }
  throw modelJsonError(failureMessage, lastError?.status || 502);
}

function databaseFailure(res, operation, error) {
  if (error) {
    console.error(`Study database ${operation} failed`, {
      code: error.code || 'unknown',
      status: error.status || 0
    });
  }
  return res.status(503).json({
    error: `The study database is waking up or temporarily unavailable. Please try ${operation} again.`
  });
}

function normalizeCardText(value) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function normalizeDeckName(value) {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

function cardMetadata(input = {}) {
  return {
    subject: typeof input.subject === 'string' ? input.subject.trim().slice(0, 120) : '',
    unit: typeof input.unit === 'string' ? input.unit.trim().slice(0, 120) : '',
    format: ['basic', 'definition', 'fill_blank'].includes(input.format) ? input.format : 'basic',
    aiGenerated: input.aiGenerated === true,
    mastered: input.mastered === true,
    sourceDocumentId: typeof input.sourceDocumentId === 'string' ? input.sourceDocumentId.slice(0, 200) : null,
    sourceDocumentTitle: typeof input.sourceDocumentTitle === 'string' ? input.sourceDocumentTitle.slice(0, 200) : null,
    sourceNoteId: typeof input.sourceNoteId === 'string' ? input.sourceNoteId.slice(0, 200) : null,
    sourceNoteTitle: typeof input.sourceNoteTitle === 'string' ? input.sourceNoteTitle.slice(0, 200) : null
  };
}

async function findOrCreateDeck(client, name) {
  const result = await client.query(
    `INSERT INTO decks (name) VALUES ($1)
     ON CONFLICT (lower(name)) DO UPDATE SET name = decks.name
     RETURNING id::text, name`,
    [name]
  );
  return result.rows[0];
}

const CARD_SELECT = `card.id::text, card.deck_id::text, deck.name AS topic,
  COALESCE(NULLIF(card.subject, ''), deck.name) AS subject, card.unit, card.format,
  card.front, card.back, card.ai_generated AS "aiGenerated", card.mastered,
  card.source_document_id AS "sourceDocumentId",
  card.source_document_title AS "sourceDocumentTitle",
  card.source_note_id AS "sourceNoteId", card.source_note_title AS "sourceNoteTitle",
  card.ease_factor, card.interval_days, card.repetitions, card.due_at, card.created_at`;

function validateCardInput(card) {
  if (!card || typeof card.front !== 'string' || typeof card.back !== 'string') {
    return { error: 'Each card needs a question and an answer.' };
  }
  const front = card.front.trim();
  const back = card.back.trim();
  if (!front || !back || front.length > 500 || back.length > 2000) {
    return { error: 'Card text must be non-empty and within the supported length.' };
  }
  return { front, back, metadata: cardMetadata(card) };
}


function validateDocument(req, res) {
  const { document } = req.body;
  if (!document || typeof document.text !== 'string' || !document.text.trim()) {
    res.status(400).json({ error: 'A document with extracted text is required' });
    return null;
  }

  return {
    title: String(document.title || 'Untitled document').slice(0, 200),
    course: String(document.course || 'General').slice(0, 120),
    unit: String(document.unit || 'General').slice(0, 120),
    text: document.text.slice(0, 16000)
  };
}

function validateReferences(value, res) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 12) {
    res.status(400).json({ error: 'References must be an array of at most 12 items.' });
    return null;
  }

  let totalTextLength = 0;
  const references = [];
  for (const reference of value) {
    if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
      res.status(400).json({ error: 'Each reference must be an object.' });
      return null;
    }

    const type = typeof reference.type === 'string' ? reference.type.trim() : '';
    const normalizedType = ({ document: 'doc', flashcard: 'card' })[type.toLowerCase()] || type.toLowerCase();
    if (!['note', 'doc', 'card', 'progress', 'assignment', 'class', 'session', 'quiz'].includes(normalizedType)) {
      res.status(400).json({ error: 'Each reference must have a supported source type.' });
      return null;
    }

    if (typeof reference.title !== 'string'
      || reference.title.length > 200
      || (normalizedType !== 'card' && !reference.title.trim())) {
      res.status(400).json({ error: 'Each reference must have a valid title.' });
      return null;
    }
    if (reference.course !== undefined
      && (typeof reference.course !== 'string' || reference.course.length > 120)) {
      res.status(400).json({ error: 'Each reference must have a valid course.' });
      return null;
    }
    if (reference.sourceId !== undefined
      && !((typeof reference.sourceId === 'string'
        && reference.sourceId.trim().length > 0
        && reference.sourceId.length <= 200)
        || (typeof reference.sourceId === 'number' && Number.isFinite(reference.sourceId)))) {
      res.status(400).json({ error: 'Each reference must have a valid source ID.' });
      return null;
    }
    if (typeof reference.text !== 'string' || !reference.text.trim() || reference.text.length > 6000) {
      res.status(400).json({ error: 'Each reference must contain text of at most 6000 characters.' });
      return null;
    }

    totalTextLength += reference.text.length;
    if (totalTextLength > 32000) {
      res.status(400).json({ error: 'The reference material is too long.' });
      return null;
    }

    references.push({
      type,
      normalizedType,
      title: reference.title.trim(),
      ...(reference.course !== undefined ? { course: reference.course.trim() } : {}),
      ...(reference.sourceId !== undefined && normalizedType !== 'progress' ? { sourceId: reference.sourceId } : {}),
      text: reference.text.trim()
    });
  }
  return references;
}

function getReferenceLabel(reference) {
  if (reference.normalizedType === 'card') return '[Card]';
  if (reference.normalizedType === 'progress') return '[Progress]';
  const sourceType = {
    note: 'Note',
    doc: 'Doc',
    assignment: 'Assignment',
    class: 'Class',
    session: 'Session',
    quiz: 'Quiz'
  }[reference.normalizedType];
  const safeTitle = reference.title.replace(/[\u0000-\u001f\u007f[\]]/g, ' ');
  return `[${sourceType}: ${safeTitle}]`;
}

function normalizeGeneratedText(value) {
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"');
}

function parseNotesMarkdown(text, document) {
  const markdown = normalizeGeneratedText(text.trim())
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim().replace(/[*_`]/g, '')
    || `${document.title} notes`;
  const headings = [...markdown.matchAll(/^##\s+(.+)$/gm)];
  const sections = headings.map((heading, index) => ({
    title: heading[1].trim().replace(/[*_`]/g, ''),
    content: markdown.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? markdown.length).trim()
  }));
  const sectionContent = name => sections.find(section => section.title.toLowerCase() === name)?.content || '';
  const summary = sectionContent('summary');
  const conceptsText = sectionContent('key concepts');
  const keyConcepts = conceptsText
    .split(/\r?\n/)
    .map(line => line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/)?.[1]?.trim())
    .filter(Boolean);
  const studyNotes = sections.find(section => ['study notes', 'notes', 'detailed notes'].includes(section.title.toLowerCase()));
  const body = studyNotes
    ? studyNotes.content
    : sections.filter(section => !['summary', 'key concepts'].includes(section.title.toLowerCase()))
      .map(section => `## ${section.title}\n\n${section.content}`)
      .join('\n\n') || markdown;

  return {
    title: normalizeGeneratedText(title).slice(0, 200),
    summary: normalizeGeneratedText(summary).slice(0, 4000),
    keyConcepts: keyConcepts.slice(0, 30).map(concept => normalizeGeneratedText(concept).slice(0, 1000)),
    body: normalizeGeneratedText(body).slice(0, 12000)
  };
}

function parseNotesResponse(text, document) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !/^```(?:json)?\s*\{/i.test(trimmed)) {
    return parseNotesMarkdown(trimmed, document);
  }

  const payload = parseJsonText(trimmed);
  if (!payload || Array.isArray(payload) || typeof payload !== 'object'
    || typeof payload.title !== 'string'
    || typeof payload.summary !== 'string'
    || !Array.isArray(payload.keyConcepts)
    || !payload.keyConcepts.every(value => typeof value === 'string')
    || typeof payload.body !== 'string') throw malformedJsonError();
  return {
    title: normalizeGeneratedText(payload.title.slice(0, 200)),
    summary: normalizeGeneratedText(payload.summary.slice(0, 4000)),
    keyConcepts: payload.keyConcepts.slice(0, 30).map(normalizeGeneratedText),
    body: normalizeGeneratedText(payload.body.slice(0, 12000))
  };
}

app.post('/api/ai', async (req, res) => {
  const input = typeof req.body.input === 'string' ? req.body.input.trim() : '';
  const history = Array.isArray(req.body.history) ? req.body.history : [];
  if (!input) return res.status(400).json({ error: 'A question is required.' });
  if (input.length > 4000 || history.length > 40) {
    return res.status(400).json({ error: 'The question or conversation is too long.' });
  }
  const references = validateReferences(req.body.references, res);
  if (!references) return;

  const messages = history
    .filter(message => ['user', 'assistant'].includes(message?.role) && typeof message.content === 'string')
    .map(message => ({ role: message.role, content: message.content.slice(0, 4000) }));
  messages.push({ role: 'user', content: input });
  const systemMessages = [{ role: 'system', content: prompts.tutor }];
  if (references.length) {
    const sourceMaterial = references.map(reference => ({
      label: getReferenceLabel(reference),
      course: reference.course,
      text: reference.text
    }));
    const encodedSourceMaterial = JSON.stringify(sourceMaterial)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e');
    systemMessages.push({
      role: 'system',
      content: `${prompts.tutorReferences}\n\n<untrusted_reference_material>\n${encodedSourceMaterial}\n</untrusted_reference_material>`
    });
  }
  const streaming = req.body.stream === true;
  const streamController = streaming ? new AbortController() : null;
  const abortOnDisconnect = () => {
    if (!res.writableEnded) streamController?.abort();
  };
  if (streaming) {
    req.on('aborted', abortOnDisconnect);
    res.on('close', abortOnDisconnect);
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
  }

  try {
    const reply = await callOllama([...systemMessages, ...messages], streaming ? {
      signal: streamController.signal,
      onToken: token => {
        if (!res.destroyed) res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    } : undefined);
    const result = {
      reply,
      sources: references.map(reference => ({
        type: reference.type,
        title: reference.title,
        ...(reference.course !== undefined ? { course: reference.course } : {}),
        ...(reference.sourceId !== undefined ? { sourceId: reference.sourceId } : {}),
        label: getReferenceLabel(reference)
      }))
    };
    if (streaming) {
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify({ ...result, done: true })}\n\n`);
        res.end();
      }
    } else {
      res.json(result);
    }
  } catch (error) {
    if (streaming && res.headersSent) {
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify({
          error: error.upstreamStatus
            ? `Ollama rejected the request (upstream status: ${error.upstreamStatus})`
            : 'Could not reach the AI tutor. Please try again.',
          status: Number(error.status) || 502
        })}\n\n`);
        res.end();
      }
    } else {
      sendAiError(res, error, 'Could not reach the AI tutor. Please try again.');
    }
  } finally {
    if (streaming) {
      req.off('aborted', abortOnDisconnect);
      res.off('close', abortOnDisconnect);
    }
  }
});

app.post('/api/cards/generate', async (req, res) => {
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim().slice(0, 6000) : '';
  const topic = typeof req.body.topic === 'string' ? req.body.topic.trim().slice(0, 120) : '';
  const requestedCount = req.body.count === undefined ? 5 : Number(req.body.count);
  if (!notes) return res.status(400).json({ error: 'Add notes before generating flashcards.' });
  if (!topic) return res.status(400).json({ error: 'Enter a topic for these flashcards.' });
  if (!Number.isFinite(requestedCount) || requestedCount < 1) {
    return res.status(400).json({ error: 'Card count must be at least 1.' });
  }
  const count = Math.min(15, Math.floor(requestedCount));
  const prompt = [
    'Create study flashcards from the supplied notes.',
    `Return ONLY valid JSON in this exact shape: {"cards":[{"front":"...","back":"..."}]}.`,
    `Create at most ${count} cards about the topic "${topic}".`,
    'Every question must be answerable from the notes alone. Test one idea per card. Avoid duplicate or near-duplicate questions.',
    'Use concise fronts and clear, accurate backs. Do not invent facts.'
  ].join(' ');
  try {
    const result = await callOllamaJson([
      { role: 'system', content: prompt },
      { role: 'user', content: `Notes:\n${notes}` }
    ], payload => {
      if (!payload || Array.isArray(payload) || typeof payload !== 'object' || !Array.isArray(payload.cards)) {
        throw modelJsonError('The AI did not return a card list.');
      }
      const seen = new Set();
      const cards = [];
      for (const card of payload.cards) {
        if (!card || typeof card.front !== 'string' || typeof card.back !== 'string') {
          throw modelJsonError('The AI returned an invalid card.');
        }
        const front = card.front.trim();
        const back = card.back.trim();
        if (!front || !back || front.length > 500 || back.length > 2000) {
          throw modelJsonError('The AI returned a card with invalid text length.');
        }
        const key = normalizeCardText(front);
        if (seen.has(key)) continue;
        seen.add(key);
        cards.push({ front, back });
        if (cards.length === count) break;
      }
      if (!cards.length) throw modelJsonError('The AI did not return any usable cards.');
      return cards;
    }, 'Could not generate valid flashcards. Please try again.', 'flashcard generation');
    res.json({ topic, cards: result });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message || 'Could not generate flashcards. Please try again.' });
  }
});

app.get('/api/decks', async (req, res) => {
  try {
    const result = await dbQuery(
      `SELECT deck.id::text, deck.name, deck.created_at,
         COUNT(card.id)::int AS total_cards,
         COUNT(card.id) FILTER (WHERE card.due_at <= now())::int AS due_count
       FROM decks AS deck
       LEFT JOIN cards AS card ON card.deck_id = deck.id AND card.deleted_at IS NULL
       GROUP BY deck.id
       ORDER BY lower(deck.name), deck.id`,
      [],
      'deck lookup'
    );
    res.json({ decks: result.rows });
  } catch (error) {
    databaseFailure(res, 'load decks', error);
  }
});

app.post('/api/decks', async (req, res) => {
  const name = normalizeDeckName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Enter a name for the deck.' });
  try {
    const result = await dbQuery(
      `INSERT INTO decks (name) VALUES ($1)
       ON CONFLICT (lower(name)) DO UPDATE SET name = decks.name
       RETURNING id::text, name, created_at`,
      [name],
      'deck creation'
    );
    res.status(201).json({ deck: result.rows[0] });
  } catch (error) {
    databaseFailure(res, 'create the deck', error);
  }
});

app.patch('/api/decks/:id', async (req, res) => {
  const name = normalizeDeckName(req.body.name);
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'A valid deck ID is required.' });
  if (!name) return res.status(400).json({ error: 'Enter a name for the deck.' });
  try {
    const updated = await dbTransaction(async client => {
      const current = await client.query('SELECT id::text, name FROM decks WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!current.rows[0]) return null;
      const result = await client.query(
        'UPDATE decks SET name = $1 WHERE id = $2 RETURNING id::text, name, created_at',
        [name, req.params.id]
      );
      await client.query(
        'UPDATE cards SET topic = $1, subject = CASE WHEN subject = $2 THEN $1 ELSE subject END WHERE deck_id = $3',
        [name, current.rows[0].name, req.params.id]
      );
      return result.rows[0];
    }, 'deck rename');
    if (!updated) return res.status(404).json({ error: 'This deck no longer exists.' });
    res.json({ deck: updated });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A deck with that name already exists.' });
    databaseFailure(res, 'rename the deck', error);
  }
});

app.delete('/api/decks/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'A valid deck ID is required.' });
  try {
    const deleted = await dbQuery(
      'DELETE FROM decks WHERE id = $1 RETURNING id::text',
      [req.params.id],
      'deck deletion'
    );
    if (!deleted.rowCount) return res.status(404).json({ error: 'This deck no longer exists.' });
    res.status(204).end();
  } catch (error) {
    databaseFailure(res, 'delete the deck', error);
  }
});

app.get('/api/cards', async (req, res) => {
  try {
    const result = await dbQuery(
      `SELECT ${CARD_SELECT}
       FROM cards AS card
       JOIN decks AS deck ON deck.id = card.deck_id
       WHERE card.deleted_at IS NULL
       ORDER BY card.created_at DESC, card.id DESC`,
      [],
      'card lookup'
    );
    res.json({ cards: result.rows });
  } catch (error) {
    databaseFailure(res, 'load flashcards', error);
  }
});

app.post('/api/cards', async (req, res) => {
  const card = validateCardInput(req.body);
  if (card.error) return res.status(400).json({ error: card.error });
  const deckId = typeof req.body.deck_id === 'string' || typeof req.body.deck_id === 'number'
    ? String(req.body.deck_id)
    : '';
  const deckName = normalizeDeckName(req.body.deck_name || req.body.subject) || 'General';
  if (deckId && !/^\d+$/.test(deckId)) return res.status(400).json({ error: 'A valid deck ID is required.' });
  try {
    const saved = await dbTransaction(async client => {
      const deck = deckId
        ? (await client.query('SELECT id::text, name FROM decks WHERE id = $1', [deckId])).rows[0]
        : await findOrCreateDeck(client, deckName);
      if (!deck) {
        const error = new Error('This deck no longer exists.');
        error.status = 404;
        throw error;
      }
      const metadata = card.metadata;
      const result = await client.query(
        `INSERT INTO cards
          (deck_id, topic, subject, unit, format, front, back, ai_generated, mastered,
           source_document_id, source_document_title, source_note_id, source_note_title)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id::text`,
        [deck.id, deck.name, metadata.subject || deck.name, metadata.unit, metadata.format,
          card.front, card.back, metadata.aiGenerated, metadata.mastered, metadata.sourceDocumentId,
          metadata.sourceDocumentTitle, metadata.sourceNoteId, metadata.sourceNoteTitle]
      );
      const selected = await client.query(
        `SELECT ${CARD_SELECT} FROM cards AS card
         JOIN decks AS deck ON deck.id = card.deck_id WHERE card.id = $1`,
        [result.rows[0].id]
      );
      return selected.rows[0];
    }, 'card creation');
    res.status(201).json({ card: saved });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    databaseFailure(res, 'save the flashcard', error);
  }
});

app.patch('/api/cards/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'A valid card ID is required.' });
  const card = validateCardInput(req.body);
  if (card.error) return res.status(400).json({ error: card.error });
  const deckId = typeof req.body.deck_id === 'string' || typeof req.body.deck_id === 'number'
    ? String(req.body.deck_id)
    : '';
  if (!/^\d+$/.test(deckId)) return res.status(400).json({ error: 'A valid deck ID is required.' });
  try {
    const updated = await dbTransaction(async client => {
      const deck = await client.query('SELECT id::text, name FROM decks WHERE id = $1', [deckId]);
      if (!deck.rows[0]) {
        const error = new Error('This deck no longer exists.');
        error.status = 404;
        throw error;
      }
      const metadata = card.metadata;
      const result = await client.query(
        `UPDATE cards SET deck_id = $1, topic = $2, subject = $3, unit = $4, format = $5,
           front = $6, back = $7, ai_generated = $8, mastered = $9,
           source_document_id = $10, source_document_title = $11,
           source_note_id = $12, source_note_title = $13
         WHERE id = $14 AND deleted_at IS NULL
         RETURNING id::text`,
        [deckId, deck.rows[0].name, metadata.subject || deck.rows[0].name, metadata.unit,
          metadata.format, card.front, card.back, metadata.aiGenerated, metadata.mastered,
          metadata.sourceDocumentId, metadata.sourceDocumentTitle, metadata.sourceNoteId,
          metadata.sourceNoteTitle, req.params.id]
      );
      if (!result.rows[0]) return null;
      const selected = await client.query(
        `SELECT ${CARD_SELECT} FROM cards AS card
         JOIN decks AS deck ON deck.id = card.deck_id WHERE card.id = $1`,
        [req.params.id]
      );
      return selected.rows[0];
    }, 'card update');
    if (!updated) return res.status(404).json({ error: 'This flashcard no longer exists.' });
    res.json({ card: updated });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    databaseFailure(res, 'update the flashcard', error);
  }
});

app.delete('/api/cards/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'A valid card ID is required.' });
  try {
    const result = req.query.purge === 'true'
      ? await dbQuery('DELETE FROM cards WHERE id = $1 RETURNING id::text', [req.params.id], 'card purge')
      : await dbQuery(
        'UPDATE cards SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id::text',
        [req.params.id],
        'card deletion'
      );
    if (!result.rowCount) return res.status(404).json({ error: 'This flashcard no longer exists.' });
    res.status(204).end();
  } catch (error) {
    databaseFailure(res, req.query.purge === 'true' ? 'permanently delete the flashcard' : 'delete the flashcard', error);
  }
});

app.post('/api/cards/:id/restore', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'A valid card ID is required.' });
  try {
    const result = await dbQuery(
      'UPDATE cards SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id::text',
      [req.params.id],
      'card restore'
    );
    if (!result.rowCount) return res.status(404).json({ error: 'This flashcard can no longer be restored.' });
    res.status(204).end();
  } catch (error) {
    databaseFailure(res, 'restore the flashcard', error);
  }
});

app.post('/api/cards/import', async (req, res) => {
  if (!Array.isArray(req.body.cards) || req.body.cards.length > 5000) {
    return res.status(400).json({ error: 'Import must contain no more than 5000 flashcards.' });
  }
  const imported = [];
  const seen = new Set();
  for (const input of req.body.cards) {
    const card = validateCardInput(input);
    if (card.error) return res.status(400).json({ error: card.error });
    const deckName = normalizeDeckName(input.deck_name || input.deck || input.topic || input.subject) || 'General';
    const metadata = card.metadata;
    const key = `${deckName.toLocaleLowerCase()}|${normalizeCardText(card.front)}|${normalizeCardText(card.back)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    imported.push({
      deck_name: deckName,
      front: card.front,
      back: card.back,
      subject: metadata.subject || deckName,
      unit: metadata.unit,
      format: metadata.format,
      ai_generated: metadata.aiGenerated,
      mastered: metadata.mastered,
      source_document_id: metadata.sourceDocumentId,
      source_document_title: metadata.sourceDocumentTitle,
      source_note_id: metadata.sourceNoteId,
      source_note_title: metadata.sourceNoteTitle
    });
  }
  try {
    const count = await dbTransaction(async client => {
      await client.query(
        `INSERT INTO decks (name)
         SELECT DISTINCT item.deck_name
         FROM jsonb_to_recordset($1::jsonb) AS item(deck_name TEXT)
         ON CONFLICT (lower(name)) DO NOTHING`,
        [JSON.stringify(imported.map(card => ({ deck_name: card.deck_name })))]
      );
      const result = await client.query(
        `WITH incoming AS (
           SELECT DISTINCT ON (
             lower(deck.name),
             lower(regexp_replace(btrim(item.front), '\\s+', ' ', 'g')),
             lower(regexp_replace(btrim(item.back), '\\s+', ' ', 'g'))
           )
             deck.id AS deck_id, deck.name AS deck_name, item.front, item.back,
             item.subject, item.unit, item.format, item.ai_generated, item.mastered,
             item.source_document_id, item.source_document_title,
             item.source_note_id, item.source_note_title
           FROM jsonb_to_recordset($1::jsonb) AS item(
             deck_name TEXT, front TEXT, back TEXT, subject TEXT, unit TEXT, format TEXT,
             ai_generated BOOLEAN, mastered BOOLEAN, source_document_id TEXT,
             source_document_title TEXT, source_note_id TEXT, source_note_title TEXT
           )
           JOIN decks AS deck ON lower(deck.name) = lower(item.deck_name)
           ORDER BY lower(deck.name),
             lower(regexp_replace(btrim(item.front), '\\s+', ' ', 'g')),
             lower(regexp_replace(btrim(item.back), '\\s+', ' ', 'g'))
         )
         INSERT INTO cards
           (deck_id, topic, subject, unit, format, front, back, ai_generated, mastered,
            source_document_id, source_document_title, source_note_id, source_note_title)
         SELECT incoming.deck_id, incoming.deck_name, incoming.subject, incoming.unit,
           incoming.format, incoming.front, incoming.back, incoming.ai_generated, incoming.mastered,
           incoming.source_document_id, incoming.source_document_title,
           incoming.source_note_id, incoming.source_note_title
         FROM incoming
         WHERE NOT EXISTS (
           SELECT 1 FROM cards AS existing
           WHERE existing.deck_id = incoming.deck_id
             AND existing.deleted_at IS NULL
             AND lower(regexp_replace(btrim(existing.front), '\\s+', ' ', 'g'))
               = lower(regexp_replace(btrim(incoming.front), '\\s+', ' ', 'g'))
             AND lower(regexp_replace(btrim(existing.back), '\\s+', ' ', 'g'))
               = lower(regexp_replace(btrim(incoming.back), '\\s+', ' ', 'g'))
         )`,
        [JSON.stringify(imported)]
      );
      return result.rowCount;
    }, 'card import');
    res.status(201).json({ imported_count: count });
  } catch (error) {
    databaseFailure(res, 'import flashcards', error);
  }
});

app.post('/api/cards/save', async (req, res) => {
  const topic = normalizeDeckName(req.body.topic);
  const requestedDeckId = typeof req.body.deck_id === 'string' || typeof req.body.deck_id === 'number'
    ? String(req.body.deck_id)
    : '';
  const inputCards = Array.isArray(req.body.cards) ? req.body.cards : [];
  if (!topic && !requestedDeckId) return res.status(400).json({ error: 'Choose a deck for these flashcards.' });
  if (requestedDeckId && !/^\d+$/.test(requestedDeckId)) return res.status(400).json({ error: 'A valid deck ID is required.' });
  if (!inputCards.length || inputCards.length > 15) {
    return res.status(400).json({ error: 'Select between 1 and 15 cards to save.' });
  }
  const seen = new Set();
  const validatedCards = [];
  for (const input of inputCards) {
    const card = validateCardInput(input);
    if (card.error) return res.status(400).json({ error: card.error });
    const key = normalizeCardText(card.front);
    if (seen.has(key)) continue;
    seen.add(key);
    validatedCards.push({
      front: card.front,
      back: card.back,
      subject: card.metadata.subject,
      unit: card.metadata.unit,
      format: card.metadata.format,
      ai_generated: card.metadata.aiGenerated,
      mastered: card.metadata.mastered,
      source_document_id: card.metadata.sourceDocumentId,
      source_document_title: card.metadata.sourceDocumentTitle,
      source_note_id: card.metadata.sourceNoteId,
      source_note_title: card.metadata.sourceNoteTitle
    });
  }
  if (!validatedCards.length) {
    return res.status(400).json({ error: 'No unique cards were selected.' });
  }
  try {
    const saved = await dbTransaction(async client => {
      const deck = requestedDeckId
        ? (await client.query('SELECT id::text, name FROM decks WHERE id = $1', [requestedDeckId])).rows[0]
        : await findOrCreateDeck(client, topic);
      if (!deck) {
        const error = new Error('This deck no longer exists.');
        error.status = 404;
        throw error;
      }
      const inserted = await client.query(
        `INSERT INTO cards
          (deck_id, topic, subject, unit, format, front, back, ai_generated, mastered,
           source_document_id, source_document_title, source_note_id, source_note_title)
         SELECT $1, $2, COALESCE(NULLIF(item.subject, ''), $2), item.unit, item.format,
           item.front, item.back, item.ai_generated, item.mastered, item.source_document_id,
           item.source_document_title, item.source_note_id, item.source_note_title
         FROM jsonb_to_recordset($3::jsonb) AS item(
           front TEXT, back TEXT, subject TEXT, unit TEXT, format TEXT, ai_generated BOOLEAN,
           mastered BOOLEAN, source_document_id TEXT, source_document_title TEXT,
           source_note_id TEXT, source_note_title TEXT
         )
         RETURNING id::text`,
        [deck.id, deck.name, JSON.stringify(validatedCards)]
      );
      const selected = await client.query(
        `SELECT ${CARD_SELECT} FROM cards AS card
         JOIN decks AS deck ON deck.id = card.deck_id
         WHERE card.id = ANY($1::bigint[]) ORDER BY card.id`,
        [inserted.rows.map(row => row.id)]
      );
      return selected.rows;
    }, 'card insert');
    res.status(201).json({ cards: saved });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    databaseFailure(res, 'save the cards', error);
  }
});

app.get('/api/review/next', async (req, res) => {
  const requestedLimit = req.query.limit === undefined ? 10 : Number(req.query.limit);
  const deckId = req.query.deck_id === undefined || req.query.deck_id === '' ? null : String(req.query.deck_id);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    return res.status(400).json({ error: 'Review limit must be a positive whole number.' });
  }
  if (deckId !== null && !/^\d+$/.test(deckId)) {
    return res.status(400).json({ error: 'A valid deck ID is required.' });
  }
  const limit = Math.min(20, requestedLimit);
  try {
    const [dueCards, dueCount] = await Promise.all([
      dbQuery(
        `SELECT ${CARD_SELECT}
         FROM cards AS card
         JOIN decks AS deck ON deck.id = card.deck_id
         WHERE card.deleted_at IS NULL AND card.due_at <= now()
           AND ($1::bigint IS NULL OR card.deck_id = $1)
         ORDER BY card.due_at ASC, card.id ASC
         LIMIT $2`,
        [deckId, limit],
        'due card lookup'
      ),
      dbQuery(
        `SELECT COUNT(*)::int AS total_due FROM cards
         WHERE deleted_at IS NULL AND due_at <= now()
           AND ($1::bigint IS NULL OR deck_id = $1)`,
        [deckId],
        'due count'
      )
    ]);
    res.json({ cards: dueCards.rows, total_due: dueCount.rows[0].total_due });
  } catch (error) {
    databaseFailure(res, 'load due cards', error);
  }
});

app.post('/api/review/grade', async (req, res) => {
  const cardId = typeof req.body.card_id === 'string' || typeof req.body.card_id === 'number'
    ? String(req.body.card_id)
    : '';
  const userAnswer = typeof req.body.user_answer === 'string' ? req.body.user_answer.trim() : null;
  const responseMs = req.body.response_ms === undefined || req.body.response_ms === null
    ? null
    : Number(req.body.response_ms);
  if (!/^\d+$/.test(cardId)) return res.status(400).json({ error: 'A valid card ID is required.' });
  if (userAnswer === null || userAnswer.length > 4000) {
    return res.status(400).json({ error: 'Answer must be text no longer than 4000 characters.' });
  }
  if (responseMs !== null && (!Number.isInteger(responseMs) || responseMs < 0 || responseMs > 86400000)) {
    return res.status(400).json({ error: 'Response time must be between 0 and 86400000 milliseconds.' });
  }

  let score = 0;
  let feedback = 'No answer was provided.';
  try {
    const selected = await dbQuery(
      'SELECT id::text, front, back FROM cards WHERE id = $1 AND deleted_at IS NULL',
      [cardId],
      'card lookup for grading'
    );
    const card = selected.rows[0];
    if (!card) return res.status(404).json({ error: 'This flashcard no longer exists.' });
    if (userAnswer) {
      const grade = await callOllamaJson([
        {
          role: 'system',
          content: 'Grade the student answer leniently on wording but strictly on meaning. Return ONLY JSON in this exact shape: {"score":0,"feedback":"one sentence on what was right or missing"}. Score must be an integer from 0 to 100. Do not require exact wording.'
        },
        {
          role: 'user',
          content: `Question: ${card.front}\nModel answer: ${card.back}\nStudent answer: ${userAnswer}`
        }
      ], payload => {
        if (!payload || Array.isArray(payload) || typeof payload !== 'object'
          || !Number.isInteger(payload.score) || payload.score < 0 || payload.score > 100
          || typeof payload.feedback !== 'string' || !payload.feedback.trim()
          || payload.feedback.trim().length > 500) {
          throw modelJsonError('The AI returned an invalid answer grade.');
        }
        return { score: payload.score, feedback: payload.feedback.trim() };
      }, 'Could not grade this answer. Please try again.', 'answer grading');
      score = grade.score;
      feedback = grade.feedback;
    }

    const quality = qualityForScore(score);
    const updatedCard = await dbTransaction(async client => {
      const locked = await client.query(
        'SELECT id::text, ease_factor, interval_days, repetitions FROM cards WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [cardId]
      );
      if (!locked.rows[0]) {
        const error = new Error('This flashcard no longer exists.');
        error.status = 404;
        throw error;
      }
      const schedule = calculateSm2(locked.rows[0], quality);
      const updated = await client.query(
        `UPDATE cards
         SET ease_factor = $1, interval_days = $2, repetitions = $3, due_at = $4
         WHERE id = $5
         RETURNING due_at`,
        [schedule.ease_factor, schedule.interval_days, schedule.repetitions, schedule.due_at, cardId]
      );
      await client.query(
        `INSERT INTO reviews (card_id, user_answer, score, quality, response_ms, feedback)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [cardId, userAnswer, score, quality, responseMs, feedback]
      );
      return updated.rows[0];
    }, 'review grade transaction');
    res.json({
      score,
      feedback,
      correct_answer: card.back,
      next_due_at: updatedCard.due_at
    });
  } catch (error) {
    if (error.status === 404) return res.status(404).json({ error: error.message });
    if (error.status) return res.status(error.status).json({ error: error.message });
    databaseFailure(res, 'save this review', error);
  }
});

app.get('/api/stats/topics', async (req, res) => {
  try {
    const [decks, activity] = await Promise.all([
      dbQuery(
        `SELECT deck.id::text AS deck_id, deck.name AS deck,
           COUNT(DISTINCT card.id)::int AS total_cards,
           COUNT(DISTINCT card.id) FILTER (WHERE card.due_at <= now())::int AS due_count,
           COUNT(review.id)::int AS review_count,
           COUNT(review.id) FILTER (
             WHERE review.reviewed_at >= now() - INTERVAL '30 days'
           )::int AS recent_review_count,
           AVG(review.score) FILTER (
             WHERE review.reviewed_at >= now() - INTERVAL '30 days'
           ) AS average_score_30d,
           (COALESCE(AVG(review.score) FILTER (
             WHERE review.reviewed_at >= now() - INTERVAL '30 days'
           ), 0) < 60 AND COUNT(review.id) FILTER (
             WHERE review.reviewed_at >= now() - INTERVAL '30 days'
           ) >= 5) AS weak
         FROM decks AS deck
         LEFT JOIN cards AS card ON card.deck_id = deck.id AND card.deleted_at IS NULL
         LEFT JOIN reviews AS review ON review.card_id = card.id
         GROUP BY deck.id, deck.name
         ORDER BY lower(deck.name)`,
        [],
        'deck statistics'
      ),
      dbQuery(
        `WITH days AS (
           SELECT generate_series(
             current_date - INTERVAL '13 days',
             current_date,
             INTERVAL '1 day'
           )::date AS day
         )
         SELECT days.day::text AS day, COUNT(reviews.id)::int AS reviews
         FROM days
         LEFT JOIN reviews
           ON reviews.reviewed_at >= days.day
          AND reviews.reviewed_at < days.day + INTERVAL '1 day'
         LEFT JOIN cards AS card ON card.id = reviews.card_id
         WHERE card.deleted_at IS NULL OR card.id IS NULL
         GROUP BY days.day
         ORDER BY days.day`,
        [],
        'review activity statistics'
      )
    ]);
    res.json({ decks: decks.rows, topics: decks.rows, activity: activity.rows });
  } catch (error) {
    databaseFailure(res, 'load topic statistics', error);
  }
});

app.post('/api/generate-notes', async (req, res) => {
  const document = validateDocument(req, res);
  if (!document) return;

  try {
    const notes = parseNotesResponse(
      await callOllama(getDocumentMessages(prompts.summarize, document)),
      document
    );
    res.json(notes);
  } catch (error) {
    sendAiError(res, error, 'Could not generate notes. Please try again.');
  }
});

app.post('/api/generate-flashcards', async (req, res) => {
  const document = validateDocument(req, res);
  if (!document) return;

  try {
    const payload = parseJsonText(await callOllama(getDocumentMessages(prompts.flashcards, document)));
    if (!payload || Array.isArray(payload) || typeof payload !== 'object' || !Array.isArray(payload.cards)) {
      throw malformedJsonError();
    }
    const seen = new Set();
    const cards = payload.cards.reduce((valid, card) => {
      if (!card || typeof card !== 'object' || Array.isArray(card)
        || typeof card.front !== 'string' || typeof card.back !== 'string') return valid;
      const front = card.front.trim().slice(0, 500);
      const back = card.back.trim().slice(0, 1000);
      const key = `${front.toLowerCase().replace(/\s+/g, ' ')}|${back.toLowerCase().replace(/\s+/g, ' ')}`;
      if (!front || !back || seen.has(key)) return valid;
      seen.add(key);
      valid.push({
        format: ['basic', 'definition', 'fill_blank'].includes(card.format) ? card.format : 'basic',
        front,
        back
      });
      return valid;
    }, []);
    res.json({
      cards
    });
  } catch (error) {
    sendAiError(res, error, 'Could not generate flashcards. Please try again.');
  }
});

app.post('/api/generate-quiz', async (req, res) => {
  const document = validateDocument(req, res);
  if (!document) return;

  try {
    const payload = parseJsonText(await callOllama(getDocumentMessages(prompts.quiz, document)));
    if (!payload || Array.isArray(payload) || typeof payload !== 'object' || !Array.isArray(payload.questions)) {
      throw malformedJsonError();
    }
    const seen = new Set();
    const questions = payload.questions.reduce((valid, question) => {
      if (!question || typeof question !== 'object' || Array.isArray(question)
        || typeof question.question !== 'string') return valid;
      const text = question.question.trim().slice(0, 800);
      const key = text.toLowerCase().replace(/\s+/g, ' ');
      if (!text || seen.has(key)) return valid;
      const type = ['multiple_choice', 'true_false', 'fill_blank', 'short_answer'].includes(question.type)
        ? question.type
        : 'short_answer';
      const rawAnswer = question.correctAnswer || question.answer;
      if (typeof rawAnswer !== 'string' || !rawAnswer.trim()) return valid;
      let options;
      let correctAnswer = rawAnswer.trim().slice(0, 500);
      if (type === 'multiple_choice') {
        options = Array.isArray(question.options)
          ? [...new Set(question.options.filter(option => typeof option === 'string').map(option => option.trim()).filter(Boolean))]
            .slice(0, 6)
            .map(option => option.slice(0, 250))
          : [];
        if (options.length < 2) return valid;
        const matchingOption = options.find(option => option.toLowerCase().replace(/\s+/g, ' ') === correctAnswer.toLowerCase().replace(/\s+/g, ' '));
        if (!matchingOption) return valid;
        correctAnswer = matchingOption;
      } else if (type === 'true_false') {
        if (!['true', 'false'].includes(correctAnswer.toLowerCase())) return valid;
        options = ['True', 'False'];
        correctAnswer = correctAnswer.toLowerCase() === 'true' ? 'True' : 'False';
      }
      seen.add(key);
      valid.push({
        type,
        question: text,
        ...(options ? { options } : {}),
        correctAnswer,
        explanation: typeof question.explanation === 'string' ? question.explanation.trim().slice(0, 800) : ''
      });
      return valid;
    }, []);
    res.json({
      questions
    });
  } catch (error) {
    sendAiError(res, error, 'Could not generate a quiz. Please try again.');
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Margin server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
