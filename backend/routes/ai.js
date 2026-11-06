const express = require('express');
const {
  tutor,
  generateTopicCards,
  generateNotes,
  generateFlashcards,
  generateQuiz
} = require('../controllers/ai');

function createAiRouter() {
  const router = express.Router();
  router.post('/api/ai', tutor);
  router.post('/api/cards/generate', generateTopicCards);
  router.post('/api/generate-notes', generateNotes);
  router.post('/api/generate-flashcards', generateFlashcards);
  router.post('/api/generate-quiz', generateQuiz);
  return router;
}

module.exports = createAiRouter;
