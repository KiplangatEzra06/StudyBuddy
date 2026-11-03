const express = require('express');

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
      const result = await dbQuery(
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
      res.json({ decks: result.rows });
    } catch (error) {
      databaseFailure(res, 'load decks', error);
    }
  });

  router.post('/api/decks', async (req, res) => {
    const name = normalizeDeckName(req.body.name);
    if (!name) return res.status(400).json({ error: 'Enter a name for the deck.' });
    try {
      const result = await dbQuery(
        `INSERT INTO decks (name) VALUES ($1)
         ON CONFLICT (lower(name)) DO UPDATE SET name = decks.name
         RETURNING id::text, name, created_at`,
        [name],
        'deck creation'
      );
      res.status(201).json({ deck: result.rows[0] });
    } catch (error) {
      databaseFailure(res, 'create the deck', error);
    }
  });

  router.patch('/api/decks/:id', async (req, res) => {
    const name = normalizeDeckName(req.body.name);
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'A valid deck ID is required.' });
    if (!name) return res.status(400).json({ error: 'Enter a name for the deck.' });
    try {
      const updated = await dbTransaction(async client => {
        const current = await client.query('SELECT id::text, name FROM decks WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (!current.rows[0]) return null;
        const result = await client.query(
          'UPDATE decks SET name = $1 WHERE id = $2 RETURNING id::text, name, created_at',
          [name, req.params.id]
        );
        await client.query(
          'UPDATE cards SET topic = $1, subject = CASE WHEN subject = $2 THEN $1 ELSE subject END WHERE deck_id = $3',
          [name, current.rows[0].name, req.params.id]
        );
        return result.rows[0];
      }, 'deck rename');
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
      const deleted = await dbQuery(
        'DELETE FROM decks WHERE id = $1 RETURNING id::text',
        [req.params.id],
        'deck deletion'
      );
      if (!deleted.rowCount) return res.status(404).json({ error: 'This deck no longer exists.' });
      res.status(204).end();
    } catch (error) {
      databaseFailure(res, 'delete the deck', error);
    }
  });

  router.get('/api/cards', async (req, res) => {
    try {
      const result = await dbQuery(
        `SELECT ${CARD_SELECT}
         FROM cards AS card
         JOIN decks AS deck ON deck.id = card.deck_id
         WHERE card.deleted_at IS NULL
         ORDER BY card.created_at DESC, card.id DESC`,
        [],
        'card lookup'
      );
      res.json({ cards: result.rows });
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
      const saved = await dbTransaction(async client => {
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
          `SELECT ${CARD_SELECT} FROM cards AS card
           JOIN decks AS deck ON deck.id = card.deck_id WHERE card.id = $1`,
          [result.rows[0].id]
        );
        return selected.rows[0];
      }, 'card creation');
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
      const updated = await dbTransaction(async client => {
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
            metadata.sourceNoteTitle, req.params.id]
        );
        if (!result.rows[0]) return null;
        const selected = await client.query(
          `SELECT ${CARD_SELECT} FROM cards AS card
           JOIN decks AS deck ON deck.id = card.deck_id WHERE card.id = $1`,
          [req.params.id]
        );
        return selected.rows[0];
      }, 'card update');
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
        ? await dbQuery('DELETE FROM cards WHERE id = $1 RETURNING id::text', [req.params.id], 'card purge')
        : await dbQuery(
          'UPDATE cards SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id::text',
          [req.params.id],
          'card deletion'
        );
      if (!result.rowCount) return res.status(404).json({ error: 'This flashcard no longer exists.' });
      res.status(204).end();
    } catch (error) {
      databaseFailure(res, req.query.purge === 'true' ? 'permanently delete the flashcard' : 'delete the flashcard', error);
    }
  });

  router.post('/api/cards/:id/restore', async (req, res) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'A valid card ID is required.' });
    try {
      const result = await dbQuery(
        'UPDATE cards SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id::text',
        [req.params.id],
        'card restore'
      );
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
      const count = await dbTransaction(async client => {
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
      const saved = await dbTransaction(async client => {
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
          `SELECT ${CARD_SELECT} FROM cards AS card
           JOIN decks AS deck ON deck.id = card.deck_id
           WHERE card.id = ANY($1::bigint[]) ORDER BY card.id`,
          [inserted.rows.map(row => row.id)]
        );
        return selected.rows;
      }, 'card insert');
      res.status(201).json({ cards: saved });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      databaseFailure(res, 'save the cards', error);
    }
  });
  return router;
}

module.exports = createCardsRouter;
