const express = require('express');
const {
  listDecks,
  createDeck,
  renameDeck,
  deleteDeck,
  listCards,
  createCard,
  updateCard,
  deleteCard,
  restoreCard,
  importCards,
  saveCards
} = require('../controllers/cards');

function createCardsRouter() {
  const router = express.Router();
  router.get('/api/decks', listDecks);
  router.post('/api/decks', createDeck);
  router.patch('/api/decks/:id', renameDeck);
  router.delete('/api/decks/:id', deleteDeck);
  router.get('/api/cards', listCards);
  router.post('/api/cards', createCard);
  router.patch('/api/cards/:id', updateCard);
  router.delete('/api/cards/:id', deleteCard);
  router.post('/api/cards/:id/restore', restoreCard);
  router.post('/api/cards/import', importCards);
  router.post('/api/cards/save', saveCards);
  return router;
}

module.exports = createCardsRouter;
