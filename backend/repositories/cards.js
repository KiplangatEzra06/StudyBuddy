async function listCards(query, cardSelect) {
  const result = await query(
    `SELECT ${cardSelect}
         FROM cards AS card
         JOIN decks AS deck ON deck.id = card.deck_id
         WHERE card.deleted_at IS NULL
         ORDER BY card.created_at DESC, card.id DESC`,
    [],
    'card lookup'
  );
  return result.rows;
}

async function createCard(transaction, cardSelect, findOrCreateDeck, { deckId, deckName, card }) {
  return transaction(async client => {
    const deck = deckId
      ? (await client.query('SELECT id::text, name FROM decks WHERE id = $1', [deckId])).rows[0]
      : await findOrCreateDeck(client, deckName);
    if (!deck) {
      const error = new Error('This deck no longer exists.');
      error.status = 404;
      throw error;
    }
    const metadata = card.metadata;
    const result = await client.query(
      `INSERT INTO cards
            (deck_id, topic, subject, unit, format, front, back, ai_generated, mastered,
             source_document_id, source_document_title, source_note_id, source_note_title)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id::text`,
      [deck.id, deck.name, metadata.subject || deck.name, metadata.unit, metadata.format,
        card.front, card.back, metadata.aiGenerated, metadata.mastered, metadata.sourceDocumentId,
        metadata.sourceDocumentTitle, metadata.sourceNoteId, metadata.sourceNoteTitle]
    );
    const selected = await client.query(
      `SELECT ${cardSelect} FROM cards AS card
           JOIN decks AS deck ON deck.id = card.deck_id WHERE card.id = $1`,
      [result.rows[0].id]
    );
    return selected.rows[0];
  }, 'card creation');
}

async function updateCard(transaction, cardSelect, { id, deckId, card }) {
  return transaction(async client => {
    const deck = await client.query('SELECT id::text, name FROM decks WHERE id = $1', [deckId]);
    if (!deck.rows[0]) {
      const error = new Error('This deck no longer exists.');
      error.status = 404;
      throw error;
    }
    const metadata = card.metadata;
    const result = await client.query(
      `UPDATE cards SET deck_id = $1, topic = $2, subject = $3, unit = $4, format = $5,
             front = $6, back = $7, ai_generated = $8, mastered = $9,
             source_document_id = $10, source_document_title = $11,
             source_note_id = $12, source_note_title = $13
           WHERE id = $14 AND deleted_at IS NULL
           RETURNING id::text`,
      [deckId, deck.rows[0].name, metadata.subject || deck.rows[0].name, metadata.unit,
        metadata.format, card.front, card.back, metadata.aiGenerated, metadata.mastered,
        metadata.sourceDocumentId, metadata.sourceDocumentTitle, metadata.sourceNoteId,
        metadata.sourceNoteTitle, id]
    );
    if (!result.rows[0]) return null;
    const selected = await client.query(
      `SELECT ${cardSelect} FROM cards AS card
           JOIN decks AS deck ON deck.id = card.deck_id WHERE card.id = $1`,
      [id]
    );
    return selected.rows[0];
  }, 'card update');
}

async function purgeCard(query, id) {
  return query('DELETE FROM cards WHERE id = $1 RETURNING id::text', [id], 'card purge');
}

async function softDeleteCard(query, id) {
  return query(
    'UPDATE cards SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id::text',
    [id],
    'card deletion'
  );
}

async function restoreCard(query, id) {
  return query(
    'UPDATE cards SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id::text',
    [id],
    'card restore'
  );
}

async function importCards(transaction, imported) {
  return transaction(async client => {
    await client.query(
      `INSERT INTO decks (name)
           SELECT DISTINCT item.deck_name
           FROM jsonb_to_recordset($1::jsonb) AS item(deck_name TEXT)
           ON CONFLICT (lower(name)) DO NOTHING`,
      [JSON.stringify(imported.map(card => ({ deck_name: card.deck_name })))]
    );
    const result = await client.query(
      `WITH incoming AS (
             SELECT DISTINCT ON (
               lower(deck.name),
               lower(regexp_replace(btrim(item.front), '\\s+', ' ', 'g')),
               lower(regexp_replace(btrim(item.back), '\\s+', ' ', 'g'))
             )
               deck.id AS deck_id, deck.name AS deck_name, item.front, item.back,
               item.subject, item.unit, item.format, item.ai_generated, item.mastered,
               item.source_document_id, item.source_document_title,
               item.source_note_id, item.source_note_title
             FROM jsonb_to_recordset($1::jsonb) AS item(
               deck_name TEXT, front TEXT, back TEXT, subject TEXT, unit TEXT, format TEXT,
               ai_generated BOOLEAN, mastered BOOLEAN, source_document_id TEXT,
               source_document_title TEXT, source_note_id TEXT, source_note_title TEXT
             )
             JOIN decks AS deck ON lower(deck.name) = lower(item.deck_name)
             ORDER BY lower(deck.name),
               lower(regexp_replace(btrim(item.front), '\\s+', ' ', 'g')),
               lower(regexp_replace(btrim(item.back), '\\s+', ' ', 'g'))
           )
           INSERT INTO cards
             (deck_id, topic, subject, unit, format, front, back, ai_generated, mastered,
              source_document_id, source_document_title, source_note_id, source_note_title)
           SELECT incoming.deck_id, incoming.deck_name, incoming.subject, incoming.unit,
             incoming.format, incoming.front, incoming.back, incoming.ai_generated, incoming.mastered,
             incoming.source_document_id, incoming.source_document_title,
             incoming.source_note_id, incoming.source_note_title
           FROM incoming
           WHERE NOT EXISTS (
             SELECT 1 FROM cards AS existing
             WHERE existing.deck_id = incoming.deck_id
               AND existing.deleted_at IS NULL
               AND lower(regexp_replace(btrim(existing.front), '\\s+', ' ', 'g'))
                 = lower(regexp_replace(btrim(incoming.front), '\\s+', ' ', 'g'))
               AND lower(regexp_replace(btrim(existing.back), '\\s+', ' ', 'g'))
                 = lower(regexp_replace(btrim(incoming.back), '\\s+', ' ', 'g'))
           )`,
      [JSON.stringify(imported)]
    );
    return result.rowCount;
  }, 'card import');
}

async function saveCards(transaction, cardSelect, findOrCreateDeck, { requestedDeckId, topic, validatedCards }) {
  return transaction(async client => {
    const deck = requestedDeckId
      ? (await client.query('SELECT id::text, name FROM decks WHERE id = $1', [requestedDeckId])).rows[0]
      : await findOrCreateDeck(client, topic);
    if (!deck) {
      const error = new Error('This deck no longer exists.');
      error.status = 404;
      throw error;
    }
    const inserted = await client.query(
      `INSERT INTO cards
            (deck_id, topic, subject, unit, format, front, back, ai_generated, mastered,
             source_document_id, source_document_title, source_note_id, source_note_title)
           SELECT $1, $2, COALESCE(NULLIF(item.subject, ''), $2), item.unit, item.format,
             item.front, item.back, item.ai_generated, item.mastered, item.source_document_id,
             item.source_document_title, item.source_note_id, item.source_note_title
           FROM jsonb_to_recordset($3::jsonb) AS item(
             front TEXT, back TEXT, subject TEXT, unit TEXT, format TEXT, ai_generated BOOLEAN,
             mastered BOOLEAN, source_document_id TEXT, source_document_title TEXT,
             source_note_id TEXT, source_note_title TEXT
           )
           RETURNING id::text`,
      [deck.id, deck.name, JSON.stringify(validatedCards)]
    );
    const selected = await client.query(
      `SELECT ${cardSelect} FROM cards AS card
           JOIN decks AS deck ON deck.id = card.deck_id
           WHERE card.id = ANY($1::bigint[]) ORDER BY card.id`,
      [inserted.rows.map(row => row.id)]
    );
    return selected.rows;
  }, 'card insert');
}

module.exports = {
  listCards,
  createCard,
  updateCard,
  purgeCard,
  softDeleteCard,
  restoreCard,
  importCards,
  saveCards
};
