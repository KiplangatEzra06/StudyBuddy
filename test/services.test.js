const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getReferenceLabel,
  malformedJsonError,
  parseJsonText,
  parseNotesResponse,
  validateDocument,
  validateReferences
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
