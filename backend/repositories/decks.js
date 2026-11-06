async function listDecks(query) {
  const result = await query(
    `SELECT deck.id::text, deck.name, deck.created_at,
           COUNT(card.id)::int AS total_cards,
           COUNT(card.id) FILTER (WHERE card.due_at <= now())::int AS due_count
         FROM decks AS deck
         LEFT JOIN cards AS card ON card.deck_id = deck.id AND card.deleted_at IS NULL
         GROUP BY deck.id
         ORDER BY lower(deck.name), deck.id`,
    [],
    'deck lookup'
  );
  return result.rows;
}

async function createDeck(query, name) {
  const result = await query(
    `INSERT INTO decks (name) VALUES ($1)
         ON CONFLICT (lower(name)) DO UPDATE SET name = decks.name
         RETURNING id::text, name, created_at`,
    [name],
    'deck creation'
  );
  return result.rows[0];
}

async function renameDeck(transaction, id, name) {
  return transaction(async client => {
    const current = await client.query('SELECT id::text, name FROM decks WHERE id = $1 FOR UPDATE', [id]);
    if (!current.rows[0]) return null;
    const result = await client.query(
      'UPDATE decks SET name = $1 WHERE id = $2 RETURNING id::text, name, created_at',
      [name, id]
    );
    await client.query(
      'UPDATE cards SET topic = $1, subject = CASE WHEN subject = $2 THEN $1 ELSE subject END WHERE deck_id = $3',
      [name, current.rows[0].name, id]
    );
    return result.rows[0];
  }, 'deck rename');
}

async function deleteDeck(query, id) {
  return query(
    'DELETE FROM decks WHERE id = $1 RETURNING id::text',
    [id],
    'deck deletion'
  );
}

module.exports = {
  listDecks,
  createDeck,
  renameDeck,
  deleteDeck
};
