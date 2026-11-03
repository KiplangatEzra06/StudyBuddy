const express = require('express');

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
        dbQuery(
          `SELECT ${CARD_SELECT}
           FROM cards AS card
           JOIN decks AS deck ON deck.id = card.deck_id
           WHERE card.deleted_at IS NULL AND card.due_at <= now()
             AND ($1::bigint IS NULL OR card.deck_id = $1)
           ORDER BY card.due_at ASC, card.id ASC
           LIMIT $2`,
          [deckId, limit],
          'due card lookup'
        ),
        dbQuery(
          `SELECT COUNT(*)::int AS total_due FROM cards
           WHERE deleted_at IS NULL AND due_at <= now()
             AND ($1::bigint IS NULL OR deck_id = $1)`,
          [deckId],
          'due count'
        )
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
      const selected = await dbQuery(
        'SELECT id::text, front, back FROM cards WHERE id = $1 AND deleted_at IS NULL',
        [cardId],
        'card lookup for grading'
      );
      const card = selected.rows[0];
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
      const updatedCard = await dbTransaction(async client => {
        const locked = await client.query(
          'SELECT id::text, ease_factor, interval_days, repetitions FROM cards WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
          [cardId]
        );
        if (!locked.rows[0]) {
          const error = new Error('This flashcard no longer exists.');
          error.status = 404;
          throw error;
        }
        const schedule = calculateSm2(locked.rows[0], quality);
        const updated = await client.query(
          `UPDATE cards
           SET ease_factor = $1, interval_days = $2, repetitions = $3, due_at = $4
           WHERE id = $5
           RETURNING due_at`,
          [schedule.ease_factor, schedule.interval_days, schedule.repetitions, schedule.due_at, cardId]
        );
        await client.query(
          `INSERT INTO reviews (card_id, user_answer, score, quality, response_ms, feedback)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [cardId, userAnswer, score, quality, responseMs, feedback]
        );
        return updated.rows[0];
      }, 'review grade transaction');
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
        dbQuery(
          `SELECT deck.id::text AS deck_id, deck.name AS deck,
             COUNT(DISTINCT card.id)::int AS total_cards,
             COUNT(DISTINCT card.id) FILTER (WHERE card.due_at <= now())::int AS due_count,
             COUNT(review.id)::int AS review_count,
             COUNT(review.id) FILTER (
               WHERE review.reviewed_at >= now() - INTERVAL '30 days'
             )::int AS recent_review_count,
             AVG(review.score) FILTER (
               WHERE review.reviewed_at >= now() - INTERVAL '30 days'
             ) AS average_score_30d,
             (COALESCE(AVG(review.score) FILTER (
               WHERE review.reviewed_at >= now() - INTERVAL '30 days'
             ), 0) < 60 AND COUNT(review.id) FILTER (
               WHERE review.reviewed_at >= now() - INTERVAL '30 days'
             ) >= 5) AS weak
           FROM decks AS deck
           LEFT JOIN cards AS card ON card.deck_id = deck.id AND card.deleted_at IS NULL
           LEFT JOIN reviews AS review ON review.card_id = card.id
           GROUP BY deck.id, deck.name
           ORDER BY lower(deck.name)`,
          [],
          'deck statistics'
        ),
        dbQuery(
          `WITH days AS (
             SELECT generate_series(
               current_date - INTERVAL '13 days',
               current_date,
               INTERVAL '1 day'
             )::date AS day
           )
           SELECT days.day::text AS day, COUNT(reviews.id)::int AS reviews
           FROM days
           LEFT JOIN reviews
             ON reviews.reviewed_at >= days.day
            AND reviews.reviewed_at < days.day + INTERVAL '1 day'
           LEFT JOIN cards AS card ON card.id = reviews.card_id
           WHERE card.deleted_at IS NULL OR card.id IS NULL
           GROUP BY days.day
           ORDER BY days.day`,
          [],
          'review activity statistics'
        )
      ]);
      res.json({ decks: decks.rows, topics: decks.rows, activity: activity.rows });
    } catch (error) {
      databaseFailure(res, 'load topic statistics', error);
    }
  });
  return router;
}

module.exports = createReviewRouter;
