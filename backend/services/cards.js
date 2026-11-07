const decksRepository = require('../repositories/decks');

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
  return decksRepository.findOrCreateDeck(client, name);
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

module.exports = {
  CARD_SELECT,
  findOrCreateDeck,
  normalizeCardText,
  normalizeDeckName,
  validateCardInput
};
