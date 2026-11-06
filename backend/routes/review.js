const express = require('express');
const reviewsRepository = require('../repositories/reviews');

function createReviewRouter(context) {
  const {
    dbQuery,
    dbTransaction,
    databaseFailure,
    CARD_SELECT,
    callOllamaJson,
    modelJsonError,
    qualityForScore,
    calculateSm2
  } = context;
  const router = express.Router();
  router.get('/api/review/next', async (req, res) => {
    const requestedLimit = req.query.limit === undefined ? 10 : Number(req.query.limit);
    const deckId = req.query.deck_id === undefined || req.query.deck_id === '' ? null : String(req.query.deck_id);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
      return res.status(400).json({ error: 'Review limit must be a positive whole number.' });
    }
    if (deckId !== null && !/^\d+$/.test(deckId)) {
      return res.status(400).json({ error: 'A valid deck ID is required.' });
    }
    const limit = Math.min(20, requestedLimit);
    try {
      const [dueCards, dueCount] = await Promise.all([
        reviewsRepository.listDueCards(dbQuery, CARD_SELECT, deckId, limit),
        reviewsRepository.countDueCards(dbQuery, deckId)
      ]);
      res.json({ cards: dueCards.rows, total_due: dueCount.rows[0].total_due });
    } catch (error) {
      databaseFailure(res, 'load due cards', error);
    }
  });

  router.post('/api/review/grade', async (req, res) => {
    const cardId = typeof req.body.card_id === 'string' || typeof req.body.card_id === 'number'
      ? String(req.body.card_id)
      : '';
    const userAnswer = typeof req.body.user_answer === 'string' ? req.body.user_answer.trim() : null;
    const responseMs = req.body.response_ms === undefined || req.body.response_ms === null
      ? null
      : Number(req.body.response_ms);
    if (!/^\d+$/.test(cardId)) return res.status(400).json({ error: 'A valid card ID is required.' });
    if (userAnswer === null || userAnswer.length > 4000) {
      return res.status(400).json({ error: 'Answer must be text no longer than 4000 characters.' });
    }
    if (responseMs !== null && (!Number.isInteger(responseMs) || responseMs < 0 || responseMs > 86400000)) {
      return res.status(400).json({ error: 'Response time must be between 0 and 86400000 milliseconds.' });
    }

    let score = 0;
    let feedback = 'No answer was provided.';
    try {
      const card = await reviewsRepository.findCardForGrading(dbQuery, cardId);
      if (!card) return res.status(404).json({ error: 'This flashcard no longer exists.' });
      if (userAnswer) {
        const grade = await callOllamaJson([
          {
            role: 'system',
            content: 'Grade the student answer leniently on wording but strictly on meaning. Return ONLY JSON in this exact shape: {"score":0,"feedback":"one sentence on what was right or missing"}. Score must be an integer from 0 to 100. Do not require exact wording.'
          },
          {
            role: 'user',
            content: `Question: ${card.front}\nModel answer: ${card.back}\nStudent answer: ${userAnswer}`
          }
        ], payload => {
          if (!payload || Array.isArray(payload) || typeof payload !== 'object'
            || !Number.isInteger(payload.score) || payload.score < 0 || payload.score > 100
            || typeof payload.feedback !== 'string' || !payload.feedback.trim()
            || payload.feedback.trim().length > 500) {
            throw modelJsonError('The AI returned an invalid answer grade.');
          }
          return { score: payload.score, feedback: payload.feedback.trim() };
        }, 'Could not grade this answer. Please try again.', 'answer grading');
        score = grade.score;
        feedback = grade.feedback;
      }

      const quality = qualityForScore(score);
      const updatedCard = await reviewsRepository.saveReviewGrade(dbTransaction, calculateSm2, {
        cardId,
        userAnswer,
        score,
        quality,
        responseMs,
        feedback
      });
      res.json({
        score,
        feedback,
        correct_answer: card.back,
        next_due_at: updatedCard.due_at
      });
    } catch (error) {
      if (error.status === 404) return res.status(404).json({ error: error.message });
      if (error.status) return res.status(error.status).json({ error: error.message });
      databaseFailure(res, 'save this review', error);
    }
  });

  router.get('/api/stats/topics', async (req, res) => {
    try {
      const [decks, activity] = await Promise.all([
        reviewsRepository.listDeckStatistics(dbQuery),
        reviewsRepository.listReviewActivity(dbQuery)
      ]);
      res.json({ decks: decks.rows, topics: decks.rows, activity: activity.rows });
    } catch (error) {
      databaseFailure(res, 'load topic statistics', error);
    }
  });
  return router;
}

module.exports = createReviewRouter;
