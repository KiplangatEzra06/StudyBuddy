const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getReferenceLabel,
  malformedJsonError,
  parseJsonText,
  parseNotesResponse,
  parseTutorAnswerTable,
  tutorAnswerTableFallback,
  validateDocument,
  validateReferences,
  validateTutorAnswerTable
} = require('../backend/services/ai-content');
const {
  normalizeCardText,
  normalizeDeckName,
  validateCardInput
} = require('../backend/services/cards');

function responseStub() {
  return {
    statusCode: null,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

test('AI JSON parsing accepts fenced and surrounding text without accepting malformed JSON', () => {
  assert.deepEqual(parseJsonText('```json\n{"cards": []}\n```'), { cards: [] });
  assert.deepEqual(parseJsonText('Result: {"cards": []} done'), { cards: [] });
  assert.throws(() => parseJsonText('not JSON'), error => error.message === malformedJsonError().message);
});

test('notes parser preserves supported JSON and Markdown shapes', () => {
  const jsonNotes = parseNotesResponse(
    '{"title":"Topic","summary":"Summary","keyConcepts":["Concept"],"body":"Details"}',
    { title: 'Source' }
  );
  assert.deepEqual(jsonNotes, {
    title: 'Topic',
    summary: 'Summary',
    keyConcepts: ['Concept'],
    body: 'Details'
  });

  const markdownNotes = parseNotesResponse(
    '# Topic\n\n## Summary\nShort recap\n\n## Key Concepts\n- Concept\n\n## Study Notes\nDetails',
    { title: 'Source' }
  );
  assert.deepEqual(markdownNotes, {
    title: 'Topic',
    summary: 'Short recap',
    keyConcepts: ['Concept'],
    body: 'Details'
  });
});

test('Tutor answer tables validate dimensions and remove fenced JSON from text', () => {
  const parsed = parseTutorAnswerTable([
    'Start with the first trace step.',
    '',
    '```answer_table',
    '{"title":"Trace","columns":["Input","Output"],"rows":[{"label":"Step 1","cells":["x",""]}],"locked_cells":[[0,0]],"hint":"Apply the rule once."}',
    '```',
    '<!-- tutor_sources: {"sources":[{"type":"suggested_reading","title":"Official Documentation","detail":"truth tables"}]} -->'
  ].join('\n'));

  assert.equal(parsed.invalid, false);
  assert.equal(parsed.text, 'Start with the first trace step.');
  assert.deepEqual(parsed.sources, [{
    type: 'suggested_reading',
    title: 'Official Documentation',
    detail: 'truth tables'
  }]);
  assert.deepEqual(parsed.answerTable, {
    title: 'Trace',
    columns: ['Input', 'Output'],
    rows: [{ label: 'Step 1', cells: ['x', ''] }],
    locked_cells: [[0, 0]],
    hint: 'Apply the rule once.'
  });
  const prose = parseTutorAnswerTable('Explain the concept in prose.');
  assert.equal(prose.answerTable, null);
  assert.deepEqual(prose.sources, []);
  assert.equal(validateTutorAnswerTable({
    title: 'Invalid',
    columns: ['A'],
    rows: [{ label: 'Step', cells: ['', 'extra'] }],
    locked_cells: [[0, 1]],
    hint: 'Try again.'
  }), null);
  assert.equal(parseTutorAnswerTable('```answer_table\nnot json\n```').invalid, true);
  assert.match(tutorAnswerTableFallback(), /\| Step \| Your attempt \|/);
  assert.doesNotMatch(tutorAnswerTableFallback(), /```|not json/);
});

test('Tutor source metadata is structured, hidden from text, and capped at three suggested readings', () => {
  const parsed = parseTutorAnswerTable([
    'A short explanation.',
    '<!-- tutor_sources: {"sources":[',
    '{"type":"user_material","title":"Lecture notes.pdf","detail":"Chapter 2"},',
    '{"type":"suggested_reading","title":"Reading 1","detail":"topic 1"},',
    '{"type":"suggested_reading","title":"Reading 2","detail":"topic 2"},',
    '{"type":"suggested_reading","title":"Reading 3","detail":"topic 3"},',
    '{"type":"suggested_reading","title":"Reading 4","detail":"topic 4"},',
    '{"type":"invented_type","title":"Ignored","detail":"Ignored"}',
    ']} -->'
  ].join(''));

  assert.equal(parsed.text, 'A short explanation.');
  assert.deepEqual(parsed.sources, [
    { type: 'user_material', title: 'Lecture notes.pdf', detail: 'Chapter 2' },
    { type: 'suggested_reading', title: 'Reading 1', detail: 'topic 1' },
    { type: 'suggested_reading', title: 'Reading 2', detail: 'topic 2' },
    { type: 'suggested_reading', title: 'Reading 3', detail: 'topic 3' }
  ]);
});

test('document and reference validators retain their request error responses', () => {
  const response = responseStub();
  assert.equal(validateDocument({ body: { document: { text: '  ' } } }, response), null);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error, 'A document with extracted text is required');

  const invalidReferences = responseStub();
  assert.equal(validateReferences([{ type: 'unknown', title: 'Title', text: 'Text' }], invalidReferences), null);
  assert.equal(invalidReferences.statusCode, 400);
  assert.equal(invalidReferences.body.error, 'Each reference must have a supported source type.');

  const validReferences = validateReferences([{
    type: 'document',
    title: '  Source  ',
    course: '  Science ',
    sourceId: 12,
    text: '  Content  '
  }], responseStub());
  assert.deepEqual(validReferences, [{
    type: 'document',
    normalizedType: 'doc',
    title: 'Source',
    course: 'Science',
    sourceId: 12,
    text: 'Content'
  }]);
  assert.equal(getReferenceLabel({ normalizedType: 'doc', title: '[Source]' }), '[Doc:  Source ]');
});

test('card helpers normalize text and validate metadata and supported lengths', () => {
  assert.equal(normalizeCardText('  Some   TEXT '), 'some text');
  assert.equal(normalizeDeckName(`  ${'a'.repeat(125)}  `).length, 120);
  assert.equal(validateCardInput({ front: null, back: '' }).error, 'Each card needs a question and an answer.');

  const card = validateCardInput({
    front: ' Question ',
    back: ' Answer ',
    format: 'fill_blank',
    aiGenerated: true,
    sourceNoteTitle: 'Source'
  });
  assert.equal(card.front, 'Question');
  assert.equal(card.back, 'Answer');
  assert.equal(card.metadata.format, 'fill_blank');
  assert.equal(card.metadata.aiGenerated, true);
  assert.equal(card.metadata.sourceNoteTitle, 'Source');
  assert.match(validateCardInput({ front: 'Question', back: 'x'.repeat(2001) }).error, /supported length/);
});
