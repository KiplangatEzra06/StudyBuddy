async function listDueCards(query, cardSelect, deckId, limit) {
  return query(
    `SELECT ${cardSelect}
           FROM cards AS card
           JOIN decks AS deck ON deck.id = card.deck_id
           WHERE card.deleted_at IS NULL AND card.due_at <= now()
             AND ($1::bigint IS NULL OR card.deck_id = $1)
           ORDER BY card.due_at ASC, card.id ASC
           LIMIT $2`,
    [deckId, limit],
    'due card lookup'
  );
}

async function countDueCards(query, deckId) {
  return query(
    `SELECT COUNT(*)::int AS total_due FROM cards
           WHERE deleted_at IS NULL AND due_at <= now()
             AND ($1::bigint IS NULL OR deck_id = $1)`,
    [deckId],
    'due count'
  );
}

async function findCardForGrading(query, cardId) {
  const selected = await query(
    'SELECT id::text, front, back FROM cards WHERE id = $1 AND deleted_at IS NULL',
    [cardId],
    'card lookup for grading'
  );
  return selected.rows[0];
}

async function saveReviewGrade(transaction, calculateSm2, { cardId, userAnswer, score, quality, responseMs, feedback }) {
  return transaction(async client => {
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
}

async function listDeckStatistics(query) {
  return query(
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
  );
}

async function listReviewActivity(query) {
  return query(
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
  );
}

module.exports = {
  listDueCards,
  countDueCards,
  findCardForGrading,
  saveReviewGrade,
  listDeckStatistics,
  listReviewActivity
};
