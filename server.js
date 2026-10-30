/**
 * StudyBuddy Backend Server
 * Securely proxies Ollama Cloud calls for tutor and document-powered AI features.
 *
 * SETUP:
 * 1. npm install
 * 2. Create .env with OLLAMA_API_KEY and ACCESS_TOKEN configured
 * 3. npm start
 */

require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { callOllama } = require('./services/ollama');
const prompts = require('./config/prompts');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  const origin = req.get('Origin');
  res.vary('Origin');
  if (origin) {
    if (!process.env.FRONTEND_ORIGIN || origin !== process.env.FRONTEND_ORIGIN) {
      return res.status(403).json({ error: 'Blocked by CORS' });
    }
    res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_ORIGIN);
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-access-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many AI requests. Please try again in a minute.' }
});
app.use('/api', aiLimiter, (req, res, next) => {
  if (!process.env.ACCESS_TOKEN || req.get('x-access-token') !== process.env.ACCESS_TOKEN) {
    return res.status(401).json({ error: 'Invalid access token' });
  }
  next();
});
app.use(express.static(path.dirname(__filename)));

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

app.post('/api/ai', async (req, res) => {
  const input = typeof req.body.input === 'string' ? req.body.input.trim() : '';
  const history = Array.isArray(req.body.history) ? req.body.history : [];
  if (!input) return res.status(400).json({ error: 'A question is required.' });
  if (input.length > 4000 || history.length > 40) {
    return res.status(400).json({ error: 'The question or conversation is too long.' });
  }

  const messages = history
    .filter(message => ['user', 'assistant'].includes(message?.role) && typeof message.content === 'string')
    .map(message => ({ role: message.role, content: message.content.slice(0, 4000) }));
  messages.push({ role: 'user', content: input });
  try {
    const reply = await callOllama([{ role: 'system', content: prompts.tutor }, ...messages]);
    res.json({ reply });
  } catch (error) {
    sendAiError(res, error, 'Could not reach the AI tutor. Please try again.');
  }
});

app.post('/api/generate-notes', async (req, res) => {
  const document = validateDocument(req, res);
  if (!document) return;

  try {
    const payload = parseJsonText(await callOllama(getDocumentMessages(prompts.summarize, document)));
    if (!payload || Array.isArray(payload) || typeof payload !== 'object'
      || typeof payload.title !== 'string'
      || typeof payload.summary !== 'string'
      || !Array.isArray(payload.keyConcepts)
      || !payload.keyConcepts.every(value => typeof value === 'string')
      || typeof payload.body !== 'string') throw malformedJsonError();
    res.json({
      title: typeof payload.title === 'string' ? payload.title.slice(0, 200) : `${document.title} notes`,
      summary: typeof payload.summary === 'string' ? payload.summary.slice(0, 4000) : '',
      keyConcepts: Array.isArray(payload.keyConcepts) ? payload.keyConcepts.filter(value => typeof value === 'string').slice(0, 30) : [],
      body: typeof payload.body === 'string' ? payload.body.slice(0, 12000) : ''
    });
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
    const cards = payload.cards;
    res.json({
      cards: cards
        .filter(card => card && typeof card === 'object' && card.front && card.back)
        .map(card => ({
          format: ['basic', 'definition', 'fill_blank'].includes(card.format) ? card.format : 'basic',
          front: String(card.front).slice(0, 500),
          back: String(card.back).slice(0, 1000)
        }))
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
    const questions = payload.questions;
    res.json({
      questions: questions
        .filter(q => q && typeof q === 'object' && q.question && (q.correctAnswer || q.answer))
        .map(q => ({
          type: ['multiple_choice', 'true_false', 'fill_blank', 'short_answer'].includes(q.type) ? q.type : 'multiple_choice',
          question: String(q.question).slice(0, 800),
          options: Array.isArray(q.options) ? q.options.map(option => String(option).slice(0, 250)).slice(0, 6) : undefined,
          correctAnswer: String(q.correctAnswer || q.answer).slice(0, 500),
          explanation: String(q.explanation || '').slice(0, 800)
        }))
    });
  } catch (error) {
    sendAiError(res, error, 'Could not generate a quiz. Please try again.');
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Margin server running on http://localhost:${PORT}`);
});
