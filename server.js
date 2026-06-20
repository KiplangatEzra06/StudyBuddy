/**
 * Margin Backend Server
 * Securely proxies Claude API calls for Tutor and document-powered AI features.
 *
 * SETUP:
 * 1. npm install
 * 2. Create .env with ANTHROPIC_API_KEY=your_key_here
 * 3. npm start
 */

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(path.dirname(__filename)));

function extractText(data) {
  return data.content
    ?.filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n') || '';
}

function parseJsonText(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
}

async function callClaude({ system, messages, maxTokens = 1600 }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const error = new Error('ANTHROPIC_API_KEY is not configured');
    error.status = 500;
    throw error;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-1',
      max_tokens: maxTokens,
      system,
      messages
    })
  });

  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    console.error('Anthropic API error:', details);
    const error = new Error('Failed to get response from Claude');
    error.status = response.status;
    throw error;
  }

  return response.json();
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

app.post('/api/tutor', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request format' });
  }

  if (messages.length === 0) {
    return res.status(400).json({ error: 'No messages provided' });
  }

  if (messages.length > 50) {
    return res.status(400).json({ error: 'Message history too long' });
  }

  try {
    const data = await callClaude({
      maxTokens: 1024,
      system: `You are a clear, encouraging study tutor helping a university software engineering student.
Explain concepts step by step, use concrete examples, and keep answers focused and exam-relevant.
Use plain text only. No markdown formatting or symbols.
Keep responses concise, with a maximum of about 500 words.`,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      }))
    });

    const textBlock = extractText(data);
    if (!textBlock) {
      return res.status(500).json({ error: 'No response text received' });
    }

    res.json({ text: textBlock });
  } catch (error) {
    console.error('Tutor error:', error);
    res.status(error.status || 500).json({
      error: error.message || 'An unexpected error occurred'
    });
  }
});

app.post('/api/generate-notes', async (req, res) => {
  const document = validateDocument(req, res);
  if (!document) return;

  try {
    const data = await callClaude({
      maxTokens: 2200,
      system: `You generate concise study notes from source documents.
Return only valid JSON with this exact shape:
{
  "title": "string",
  "summary": "string",
  "keyConcepts": ["string"],
  "body": "string"
}
Include key concepts, definitions, formulas when present, examples, and an exam-focused summary.
Do not include markdown fences.`,
      messages: [{
        role: 'user',
        content: `Document title: ${document.title}
Course: ${document.course}
Unit: ${document.unit}

Source text:
${document.text}`
      }]
    });

    const payload = parseJsonText(extractText(data));
    res.json({
      title: payload.title || `${document.title} notes`,
      summary: payload.summary || '',
      keyConcepts: Array.isArray(payload.keyConcepts) ? payload.keyConcepts : [],
      body: payload.body || ''
    });
  } catch (error) {
    console.error('Generate notes error:', error);
    res.status(error.status || 500).json({ error: error.message || 'Could not generate notes' });
  }
});

app.post('/api/generate-flashcards', async (req, res) => {
  const document = validateDocument(req, res);
  if (!document) return;

  try {
    const data = await callClaude({
      maxTokens: 2200,
      system: `You generate editable study flashcards from source documents.
Return only valid JSON with this exact shape:
{
  "cards": [
    {"format":"basic","front":"question","back":"answer"},
    {"format":"definition","front":"term","back":"definition"},
    {"format":"fill_blank","front":"sentence with _____ blank","back":"missing answer"}
  ]
}
Create 8 to 14 high-value cards. Use only these format values: basic, definition, fill_blank.
Do not include markdown fences.`,
      messages: [{
        role: 'user',
        content: `Document title: ${document.title}
Course: ${document.course}
Unit: ${document.unit}

Source text:
${document.text}`
      }]
    });

    const payload = parseJsonText(extractText(data));
    const cards = Array.isArray(payload.cards) ? payload.cards : [];
    res.json({
      cards: cards
        .filter(card => card.front && card.back)
        .map(card => ({
          format: ['basic', 'definition', 'fill_blank'].includes(card.format) ? card.format : 'basic',
          front: String(card.front).slice(0, 500),
          back: String(card.back).slice(0, 1000)
        }))
    });
  } catch (error) {
    console.error('Generate flashcards error:', error);
    res.status(error.status || 500).json({ error: error.message || 'Could not generate flashcards' });
  }
});

app.post('/api/generate-quiz', async (req, res) => {
  const document = validateDocument(req, res);
  if (!document) return;

  try {
    const data = await callClaude({
      maxTokens: 2600,
      system: `You generate auto-gradable study quizzes from source documents.
Return only valid JSON with this exact shape:
{
  "questions": [
    {"type":"multiple_choice","question":"string","options":["A","B","C","D"],"correctAnswer":"one option exactly","explanation":"string"},
    {"type":"true_false","question":"string","options":["True","False"],"correctAnswer":"True","explanation":"string"},
    {"type":"fill_blank","question":"sentence with _____ blank","correctAnswer":"string","explanation":"string"},
    {"type":"short_answer","question":"string","correctAnswer":"short expected answer","explanation":"string"}
  ]
}
Prefer multiple_choice and true_false, include a few fill_blank items, and include at most one short_answer item.
Create 6 to 10 questions. Do not include markdown fences.`,
      messages: [{
        role: 'user',
        content: `Document title: ${document.title}
Course: ${document.course}
Unit: ${document.unit}

Source text:
${document.text}`
      }]
    });

    const payload = parseJsonText(extractText(data));
    const questions = Array.isArray(payload.questions) ? payload.questions : [];
    res.json({
      questions: questions
        .filter(q => q.question && (q.correctAnswer || q.answer))
        .map(q => ({
          type: ['multiple_choice', 'true_false', 'fill_blank', 'short_answer'].includes(q.type) ? q.type : 'multiple_choice',
          question: String(q.question).slice(0, 800),
          options: Array.isArray(q.options) ? q.options.map(option => String(option).slice(0, 250)).slice(0, 6) : undefined,
          correctAnswer: String(q.correctAnswer || q.answer).slice(0, 500),
          explanation: String(q.explanation || '').slice(0, 800)
        }))
    });
  } catch (error) {
    console.error('Generate quiz error:', error);
    res.status(error.status || 500).json({ error: error.message || 'Could not generate quiz' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Margin server running on http://localhost:${PORT}`);
  console.log('Make sure your ANTHROPIC_API_KEY is set in .env');
});
