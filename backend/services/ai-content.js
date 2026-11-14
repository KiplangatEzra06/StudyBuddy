const { generate } = require('./ai');

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

function validateTutorAnswerTable(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || typeof value.title !== 'string'
    || typeof value.hint !== 'string'
    || !Array.isArray(value.columns)
    || value.columns.length < 1
    || value.columns.length > 8
    || !value.columns.every(column => typeof column === 'string')
    || !Array.isArray(value.rows)
    || value.rows.length < 1
    || value.rows.length > 12
    || !value.rows.every(row => row && !Array.isArray(row)
      && typeof row === 'object'
      && typeof row.label === 'string'
      && Array.isArray(row.cells)
      && row.cells.length === value.columns.length
      && row.cells.every(cell => typeof cell === 'string'))
    || !Array.isArray(value.locked_cells)) return null;

  const lockedCells = new Set();
  for (const cell of value.locked_cells) {
    if (!Array.isArray(cell) || cell.length !== 2
      || !Number.isInteger(cell[0]) || !Number.isInteger(cell[1])
      || cell[0] < 0 || cell[0] >= value.rows.length
      || cell[1] < 0 || cell[1] >= value.columns.length) return null;
    const key = `${cell[0]}:${cell[1]}`;
    if (lockedCells.has(key)) return null;
    lockedCells.add(key);
  }

  return {
    title: value.title.trim(),
    columns: value.columns.map(column => column.trim()),
    rows: value.rows.map(row => ({
      label: row.label.trim(),
      cells: row.cells.map(cell => cell.trim())
    })),
    locked_cells: value.locked_cells,
    hint: value.hint.trim()
  };
}

function parseTutorAnswerTable(content, requireTable = false) {
  const pattern = /```answer_table[ \t]*\r?\n([\s\S]*?)(?:\r?\n```|$)/gi;
  const blocks = [...content.matchAll(pattern)];
  const sourcePattern = /<!--\s*tutor_sources:\s*([\s\S]*?)\s*-->/gi;
  const sourceBlocks = [...content.matchAll(sourcePattern)];
  const cleanText = content
    .replace(pattern, '')
    .replace(/<!--\s*tutor_sources\b[\s\S]*?(?:-->|$)/gi, '');
  const text = cleanText.trim();
  let sources = [];
  if (sourceBlocks.length === 1) {
    try {
      const parsedSources = JSON.parse(sourceBlocks[0][1].trim());
      if (parsedSources && !Array.isArray(parsedSources) && Array.isArray(parsedSources.sources)) {
        let suggestedReadingCount = 0;
        sources = parsedSources.sources.flatMap(source => {
          if (!source || Array.isArray(source) || typeof source !== 'object'
            || !['user_material', 'suggested_reading'].includes(source.type)
            || typeof source.title !== 'string'
            || typeof source.detail !== 'string') return [];
          const title = source.title.trim();
          const detail = source.detail.trim();
          if (!title || !detail) return [];
          if (source.type === 'suggested_reading' && suggestedReadingCount >= 3) return [];
          if (source.type === 'suggested_reading') suggestedReadingCount++;
          return [{ type: source.type, title, detail }];
        });
      }
    } catch {
      sources = [];
    }
  }
  if (!blocks.length) {
    return { text, answerTable: null, sources, invalid: requireTable };
  }
  if (blocks.length !== 1) return { text, answerTable: null, sources, invalid: true };

  try {
    const answerTable = validateTutorAnswerTable(JSON.parse(blocks[0][1].trim()));
    return answerTable
      ? { text, answerTable, sources, invalid: false }
      : { text, answerTable: null, sources, invalid: true };
  } catch {
    return { text, answerTable: null, sources, invalid: true };
  }
}

function tutorAnswerTableFallback() {
  return [
    "I couldn't prepare an editable table. Try the next step in the message box.",
    '',
    '| Step | Your attempt |',
    '| --- | --- |',
    '| Current step |  |'
  ].join('\n');
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
  if (error.code === 'AI_QUOTA_EXHAUSTED') {
    return res.status(503).json({ error: 'AI quota reached for now. Try again later.' });
  }
  if (error.status === 413) {
    return res.status(413).json({ error: error.message });
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

async function callAiJson(messages, validate, failureMessage, operation, maxTokens = 1000) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = parseJsonText(await generate({ messages, maxTokens }));
      return validate(parsed);
    } catch (error) {
      if (error.code === 'AI_QUOTA_EXHAUSTED'
        || [400, 401, 403, 413].includes(Number(error.status))) {
        throw error;
      }
      lastError = error;
      console.error(`AI ${operation} attempt failed`, {
        attempt,
        status: error.status || 0,
        code: error.code || 'unknown'
      });
    }
  }
  throw modelJsonError(failureMessage, lastError?.status || 502);
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

module.exports = {
  callAiJson,
  getDocumentMessages,
  getReferenceLabel,
  malformedJsonError,
  modelJsonError,
  normalizeGeneratedText,
  parseJsonText,
  parseNotesResponse,
  parseTutorAnswerTable,
  sendAiError,
  tutorAnswerTableFallback,
  validateTutorAnswerTable,
  validateDocument,
  validateReferences
};
