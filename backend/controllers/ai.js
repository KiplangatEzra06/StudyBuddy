const prompts = require('../config/prompts');
const { callOllama } = require('../services/ollama');
const { normalizeCardText } = require('../services/cards');
const {
  callOllamaJson,
  getDocumentMessages,
  getReferenceLabel,
  malformedJsonError,
  modelJsonError,
  parseJsonText,
  parseNotesResponse,
  sendAiError,
  validateDocument,
  validateReferences
} = require('../services/ai-content');

async function tutor(req, res) {
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
    if (references.some(reference => reference.type === 'assignment')) {
      systemMessages.push({ role: 'system', content: prompts.tutorAssignment });
    }
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
}

async function generateTopicCards(req, res) {
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
}

async function generateNotes(req, res) {
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
}

async function generateFlashcards(req, res) {
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
}

async function generateQuiz(req, res) {
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
}

module.exports = {
  tutor,
  generateTopicCards,
  generateNotes,
  generateFlashcards,
  generateQuiz
};
