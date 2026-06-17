/**
 * Margin Backend Server
 * Handles secure API calls to Claude for the Tutor feature
 * 
 * SETUP:
 * 1. Install dependencies: npm install express dotenv
 * 2. Create a .env file with: ANTHROPIC_API_KEY=your_key_here
 * 3. Run with: node server.js
 * 4. Access at http://localhost:3000
 */

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.dirname(__filename)));

// API endpoint for tutor
app.post('/api/tutor', async (req, res) => {
  const { messages } = req.body;

  // Validate input
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request format' });
  }

  if (messages.length === 0) {
    return res.status(400).json({ error: 'No messages provided' });
  }

  // Rate limiting check (optional - implement per-IP tracking in production)
  if (messages.length > 50) {
    return res.status(400).json({ error: 'Message history too long' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-1',
        max_tokens: 1024,
        system: `You are a clear, encouraging study tutor helping a university software engineering student. 
Explain concepts step by step, use concrete examples, and keep answers focused and exam-relevant. 
Use plain text only — no markdown formatting or symbols.
Keep responses concise (max ~500 words).`,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content
        }))
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Anthropic API error:', error);
      return res.status(response.status).json({
        error: 'Failed to get response from tutor service'
      });
    }

    const data = await response.json();
    const textBlock = data.content
      ?.filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n') || '';

    if (!textBlock) {
      return res.status(500).json({ error: 'No response text received' });
    }

    res.json({ text: textBlock });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      error: error.message || 'An unexpected error occurred'
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Margin server running on http://localhost:${PORT}`);
  console.log('Make sure your ANTHROPIC_API_KEY is set in .env');
});
