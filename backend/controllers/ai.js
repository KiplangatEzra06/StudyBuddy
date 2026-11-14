const prompts = require('../config/prompts');
const { generate } = require('../services/ai');
const { normalizeCardText } = require('../services/cards');
const {
  callAiJson,
  getDocumentMessages,
  getReferenceLabel,
  malformedJsonError,
  modelJsonError,
  parseJsonText,
  parseNotesResponse,
  parseTutorAnswerTable,
  sendAiError,
  tutorAnswerTableFallback,
  validateDocument,
  validateReferences
} = require('../services/ai-content');

async function aiHealthCheck(req, res) {
  let answeredModel;
  try {
    await generate({
      messages: [{ role: 'user', content: 'Reply with exactly the word OK on one line.' }],
      maxTokens: 10,
      onModel: model => {
        answeredModel = model;
      }
    });
    return res.json({ status: 'ok', model: answeredModel });
  } catch (error) {
    return sendAiError(res, error, 'AI health check failed.');
  }
}

function normalizeAvailableMaterials(materials, references) {
  const sourceItems = Array.isArray(materials) ? materials : [];
  if (sourceItems.length) {
    return sourceItems.slice(0, 8).map((item, index) => ({
      id: item && typeof item.id !== 'undefined' ? String(item.id) : `material-${index}`,
      fileName: typeof item.fileName === 'string' ? item.fileName.trim() : '',
      sectionLabels: Array.isArray(item.sectionLabels)
        ? item.sectionLabels
            .filter(label => typeof label === 'string')
            .map(label => label.trim())
            .filter(Boolean)
        : [],
      excerpt: typeof item.excerpt === 'string' ? item.excerpt.slice(0, 1000).trim() : ''
    })).filter(item => item.fileName && item.sectionLabels.length);
  }

  return references.slice(0, 8).map(reference => ({
    id: typeof reference.sourceId !== 'undefined' ? String(reference.sourceId) : reference.title,
    fileName: reference.title,
    sectionLabels: [
      typeof reference.sectionLabel === 'string' ? reference.sectionLabel.trim() : '',
      typeof reference.section === 'string' ? reference.section.trim() : '',
      typeof reference.label === 'string' ? reference.label.trim() : ''
    ].filter(Boolean).slice(0, 6),
    excerpt: reference.text.slice(0, 1000)
  })).filter(item => item.fileName && item.sectionLabels.length);
}

function validateTutorSources(sources, materials) {
  if (!Array.isArray(sources)) return [];
  const validMaterials = new Map();
  for (const material of materials) {
    if (!material || typeof material.fileName !== 'string') continue;
    const labelSet = new Set((Array.isArray(material.sectionLabels) ? material.sectionLabels : [])
      .filter(label => typeof label === 'string')
      .map(label => label.trim().toLowerCase())
      .filter(Boolean));
    validMaterials.set(material.fileName.trim().toLowerCase(), labelSet);
  }

  const validSources = [];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    if (source.type !== 'user_material') {
      validSources.push(source);
      continue;
    }

    const title = typeof source.title === 'string' ? source.title.trim() : '';
    const detail = typeof source.detail === 'string' ? source.detail.trim() : '';
    if (!title || !detail) {
      if (process.env.NODE_ENV === 'development') console.warn('Dropped tutor user_material source with missing title/detail.', source);
      continue;
    }

    const labels = validMaterials.get(title.toLowerCase());
    const allowed = labels && labels.has(detail.toLowerCase());
    if (allowed) {
      validSources.push(source);
      continue;
    }

    if (process.env.NODE_ENV === 'development') {
      console.warn('Dropped tutor user_material source because it was not in the supplied material catalogue.', {
        title,
        detail,
        catalogue: [...validMaterials.keys()]
      });
    }
  }

  return validSources;
}

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
  const providedMaterials = normalizeAvailableMaterials(req.body.materials, references);
  const systemMessages = [
    { role: 'system', content: prompts.tutor },
    { role: 'system', content: prompts.tutorSources },
    ...(providedMaterials.length ? [{ role: 'system', content: `${prompts.tutorMaterialCatalogue}\n\n<available_materials>\n${JSON.stringify(providedMaterials).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}\n</available_materials>` }] : [])
  ];
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
    const tutorMessages = [...systemMessages, ...messages];
    let responseText = await generate({
      messages: tutorMessages,
      maxTokens: 1000,
      signal: streamController?.signal
    });
    let parsedReply = parseTutorAnswerTable(responseText);
    if (parsedReply.invalid) {
      responseText = await generate({
        messages: [
          ...tutorMessages,
          { role: 'assistant', content: responseText },
          {
            role: 'user',
            content: 'Fix only the answer_table JSON block. Return one valid fenced answer_table block with a title, 1-8 string columns, 1-12 rows each with a string label and one string cell per column, string hint, and in-bounds locked_cells pairs. Leave all student-answer cells blank; do not include a solution or extra text.'
          }
        ],
        maxTokens: 1000,
        signal: streamController?.signal
      });
      parsedReply = parseTutorAnswerTable(responseText, true);
    }

    const text = parsedReply.invalid
      ? tutorAnswerTableFallback()
      : parsedReply.text || (parsedReply.answerTable ? 'Start with the first step in the table.' : '');
    if (parsedReply.invalid && process.env.NODE_ENV === 'development') {
      console.warn('Tutor answer table remained invalid after one repair attempt; using a read-only fallback.');
    }
    const result = {
      reply: text,
      text,
      answerTable: parsedReply.invalid ? null : parsedReply.answerTable,
      sources: validateTutorSources(parsedReply.sources, providedMaterials)
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
          error: error.code === 'AI_QUOTA_EXHAUSTED'
            ? 'AI quota reached for now. Try again later.'
            : error.status === 413
              ? error.message
              : 'Could not reach the AI tutor. Please try again.',
          status: error.code === 'AI_QUOTA_EXHAUSTED' ? 503 : Number(error.status) || 502
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
    const result = await callAiJson([
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
    }, 'Could not generate valid flashcards. Please try again.', 'flashcard generation', 600);
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
      await generate({ messages: getDocumentMessages(prompts.summarize, document), maxTokens: 1000 }),
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
    const payload = parseJsonText(await generate({
      messages: getDocumentMessages(prompts.flashcards, document),
      maxTokens: 600
    }));
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
    const payload = parseJsonText(await generate({
      messages: getDocumentMessages(prompts.quiz, document),
      maxTokens: 600
    }));
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
  aiHealthCheck,
  tutor,
  generateTopicCards,
  generateNotes,
  generateFlashcards,
  generateQuiz
};
