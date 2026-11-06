const express = require('express');
const decksRepository = require('../repositories/decks');
const cardsRepository = require('../repositories/cards');

function createCardsRouter(context) {
  const {
    dbQuery,
    dbTransaction,
    databaseFailure,
    normalizeDeckName,
    normalizeCardText,
    validateCardInput,
    findOrCreateDeck,
    CARD_SELECT
  } = context;
  const router = express.Router();
  router.get('/api/decks', async (req, res) => {
    try {
      const decks = await decksRepository.listDecks(dbQuery);
      res.json({ decks });
    } catch (error) {
      databaseFailure(res, 'load decks', error);
    }
  });

  router.post('/api/decks', async (req, res) => {
    const name = normalizeDeckName(req.body.name);
    if (!name) return res.status(400).json({ error: 'Enter a name for the deck.' });
    try {
      const deck = await decksRepository.createDeck(dbQuery, name);
      res.status(201).json({ deck });
    } catch (error) {
      databaseFailure(res, 'create the deck', error);
    }
  });

  router.patch('/api/decks/:id', async (req, res) => {
    const name = normalizeDeckName(req.body.name);
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'A valid deck ID is required.' });
    if (!name) return res.status(400).json({ error: 'Enter a name for the deck.' });
    try {
      const updated = await decksRepository.renameDeck(dbTransaction, req.params.id, name);
      if (!updated) return res.status(404).json({ error: 'This deck no longer exists.' });
      res.json({ deck: updated });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A deck with that name already exists.' });
      databaseFailure(res, 'rename the deck', error);
    }
  });

  router.delete('/api/decks/:id', async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'A valid deck ID is required.' });
    try {
      const deleted = await decksRepository.deleteDeck(dbQuery, req.params.id);
      if (!deleted.rowCount) return res.status(404).json({ error: 'This deck no longer exists.' });
      res.status(204).end();
    } catch (error) {
      databaseFailure(res, 'delete the deck', error);
    }
  });

  router.get('/api/cards', async (req, res) => {
    try {
      const cards = await cardsRepository.listCards(dbQuery, CARD_SELECT);
      res.json({ cards });
    } catch (error) {
      databaseFailure(res, 'load flashcards', error);
    }
  });

  router.post('/api/cards', async (req, res) => {
    const card = validateCardInput(req.body);
    if (card.error) return res.status(400).json({ error: card.error });
    const deckId = typeof req.body.deck_id === 'string' || typeof req.body.deck_id === 'number'
      ? String(req.body.deck_id)
      : '';
    const deckName = normalizeDeckName(req.body.deck_name || req.body.subject) || 'General';
    if (deckId && !/^\d+$/.test(deckId)) return res.status(400).json({ error: 'A valid deck ID is required.' });
    try {
      const saved = await cardsRepository.createCard(dbTransaction, CARD_SELECT, findOrCreateDeck, {
        deckId,
        deckName,
        card
      });
      res.status(201).json({ card: saved });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      databaseFailure(res, 'save the flashcard', error);
    }
  });

  router.patch('/api/cards/:id', async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'A valid card ID is required.' });
    const card = validateCardInput(req.body);
    if (card.error) return res.status(400).json({ error: card.error });
    const deckId = typeof req.body.deck_id === 'string' || typeof req.body.deck_id === 'number'
      ? String(req.body.deck_id)
      : '';
    if (!/^\d+$/.test(deckId)) return res.status(400).json({ error: 'A valid deck ID is required.' });
    try {
      const updated = await cardsRepository.updateCard(dbTransaction, CARD_SELECT, {
        id: req.params.id,
        deckId,
        card
      });
      if (!updated) return res.status(404).json({ error: 'This flashcard no longer exists.' });
      res.json({ card: updated });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      databaseFailure(res, 'update the flashcard', error);
    }
  });

  router.delete('/api/cards/:id', async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'A valid card ID is required.' });
    try {
      const result = req.query.purge === 'true'
        ? await cardsRepository.purgeCard(dbQuery, req.params.id)
        : await cardsRepository.softDeleteCard(dbQuery, req.params.id);
      if (!result.rowCount) return res.status(404).json({ error: 'This flashcard no longer exists.' });
      res.status(204).end();
    } catch (error) {
      databaseFailure(res, req.query.purge === 'true' ? 'permanently delete the flashcard' : 'delete the flashcard', error);
    }
  });

  router.post('/api/cards/:id/restore', async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'A valid card ID is required.' });
    try {
      const result = await cardsRepository.restoreCard(dbQuery, req.params.id);
      if (!result.rowCount) return res.status(404).json({ error: 'This flashcard can no longer be restored.' });
      res.status(204).end();
    } catch (error) {
      databaseFailure(res, 'restore the flashcard', error);
    }
  });

  router.post('/api/cards/import', async (req, res) => {
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
      const count = await cardsRepository.importCards(dbTransaction, imported);
      res.status(201).json({ imported_count: count });
    } catch (error) {
      databaseFailure(res, 'import flashcards', error);
    }
  });

  router.post('/api/cards/save', async (req, res) => {
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
      const saved = await cardsRepository.saveCards(dbTransaction, CARD_SELECT, findOrCreateDeck, {
        requestedDeckId,
        topic,
        validatedCards
      });
      res.status(201).json({ cards: saved });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      databaseFailure(res, 'save the cards', error);
    }
  });
  return router;
}

module.exports = createCardsRouter;
