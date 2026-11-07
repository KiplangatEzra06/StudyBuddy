const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const COVERED_ENDPOINTS = [
  'GET /api/decks',
  'POST /api/decks',
  'PATCH /api/decks/:id',
  'DELETE /api/decks/:id',
  'GET /api/cards',
  'POST /api/cards',
  'PATCH /api/cards/:id',
  'DELETE /api/cards/:id',
  'POST /api/cards/:id/restore',
  'POST /api/cards/import',
  'POST /api/cards/save',
  'GET /api/review/next',
  'POST /api/review/grade',
  'GET /api/stats/topics',
  'GET /api/assignments/briefs',
  'PUT /api/assignments/:assignmentId/brief/validate',
  'PUT /api/assignments/:assignmentId/brief',
  'DELETE /api/assignments/:assignmentId/brief'
];

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (!testDatabaseUrl) {
  test('deck, card, and review database integration', {
    skip: 'TEST_DATABASE_URL is not set; skipping database integration tests. Set TEST_DATABASE_URL to a dedicated PostgreSQL database (different from DATABASE_URL) to run them.'
  }, () => {});
} else {
  const shellDatabaseUrl = process.env.DATABASE_URL;
  require('dotenv').config();
  const configuredDatabaseUrl = shellDatabaseUrl || process.env.DATABASE_URL;
  if (configuredDatabaseUrl && configuredDatabaseUrl === testDatabaseUrl) {
    throw new Error('Refusing to run database integration tests because TEST_DATABASE_URL equals DATABASE_URL.');
  }

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync('secret-password', 12);
  process.env.SESSION_SECRET = 'test-session-secret-that-is-at-least-32-chars';

  const request = require('supertest');
  const { pool, query } = require('../db/pool');
  const app = require('../server');

  const testNets = ['203.0.113', '198.51.100', '192.0.2'];
  let ipSequence = 0;

  function authHeaders() {
    ipSequence += 1;
    const host = ((ipSequence - 1) % 254) + 1;
    const net = testNets[Math.floor((ipSequence - 1) / 254) % testNets.length];
    return {
      'Content-Type': 'application/json',
      'X-Requested-With': 'StudyBuddy',
      'X-Forwarded-For': `${net}.${host}`
    };
  }

  const CARD_KEYS = [
    'aiGenerated', 'back', 'created_at', 'deck_id', 'due_at', 'ease_factor', 'format', 'front',
    'id', 'interval_days', 'mastered', 'repetitions', 'sourceDocumentId', 'sourceDocumentTitle',
    'sourceNoteId', 'sourceNoteTitle', 'subject', 'topic', 'unit'
  ];

  let agent;
  let ready = false;
  let sequence = 0;

  function uniqueName(label) {
    sequence += 1;
    return `itest-${label}-${sequence}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function assertError(response, status, message) {
    assert.equal(response.status, status);
    assert.deepEqual(Object.keys(response.body).sort(), ['error']);
    assert.equal(response.body.error, message);
  }

  function assertCardShape(card) {
    assert.deepEqual(Object.keys(card).sort(), CARD_KEYS);
    assert.equal(typeof card.id, 'string');
    assert.equal(typeof card.deck_id, 'string');
    assert.equal(typeof card.topic, 'string');
    assert.equal(typeof card.subject, 'string');
    assert.equal(typeof card.unit, 'string');
    assert.equal(typeof card.format, 'string');
    assert.equal(typeof card.front, 'string');
    assert.equal(typeof card.back, 'string');
    assert.equal(typeof card.aiGenerated, 'boolean');
    assert.equal(typeof card.mastered, 'boolean');
    assert.equal(typeof card.ease_factor, 'number');
    assert.equal(typeof card.interval_days, 'number');
    assert.equal(typeof card.repetitions, 'number');
    assert.equal(typeof card.due_at, 'string');
    assert.equal(typeof card.created_at, 'string');
  }

  async function createDeck(name = uniqueName('deck')) {
    const response = await agent.post('/api/decks').set(authHeaders()).send({ name });
    assert.equal(response.status, 201);
    assert.deepEqual(Object.keys(response.body).sort(), ['deck']);
    assert.deepEqual(Object.keys(response.body.deck).sort(), ['created_at', 'id', 'name']);
    assert.equal(typeof response.body.deck.id, 'string');
    assert.equal(response.body.deck.name, name);
    assert.equal(typeof response.body.deck.created_at, 'string');
    return response.body.deck;
  }

  async function createCard(deckId, front, back) {
    const response = await agent.post('/api/cards').set(authHeaders()).send({
      deck_id: deckId,
      front,
      back
    });
    assert.equal(response.status, 201);
    assert.deepEqual(Object.keys(response.body).sort(), ['card']);
    assertCardShape(response.body.card);
    assert.equal(response.body.card.deck_id, String(deckId));
    assert.equal(response.body.card.front, front);
    assert.equal(response.body.card.back, back);
    return response.body.card;
  }

  test.describe('deck, card, and review database routes', { concurrency: false }, () => {
    test.before(async () => {
      const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
      await query(schema, [], 'test schema');
      ready = true;

      agent = request.agent(app);
      const login = await agent
        .post('/api/auth/login')
        .set(authHeaders())
        .send({ username: 'admin', password: 'secret-password' });
      assert.equal(login.status, 200);
      assert.equal(login.body.authenticated, true);
    });

    test.after(async () => {
      try {
        if (ready) {
          await query(`DELETE FROM decks WHERE name LIKE 'itest-%'`, [], 'test cleanup');
          await query(`DELETE FROM assignment_workspaces WHERE assignment_id LIKE 'itest-%'`, [], 'test assignment cleanup');
        }
      } finally {
        console.log(['Covered endpoints:', ...COVERED_ENDPOINTS.map(endpoint => `- ${endpoint}`)].join('\n'));
        await pool.end();
      }
    });

    test.describe('GET /api/decks', () => {
      test('requires an authenticated session', async () => {
        const response = await request(app).get('/api/decks');
        assertError(response, 401, 'Authentication required.');
      });

      test('returns deck summaries', async () => {
        const deck = await createDeck();
        const response = await agent.get('/api/decks').set(authHeaders());
        assert.equal(response.status, 200);
        assert.deepEqual(Object.keys(response.body).sort(), ['decks']);
        assert.ok(Array.isArray(response.body.decks));
        const listed = response.body.decks.find(item => item.id === deck.id);
        assert.ok(listed);
        assert.deepEqual(Object.keys(listed).sort(), ['created_at', 'due_count', 'id', 'name', 'total_cards']);
        assert.equal(listed.name, deck.name);
        assert.equal(listed.total_cards, 0);
        assert.equal(listed.due_count, 0);
        assert.equal(typeof listed.created_at, 'string');
      });
    });

    test.describe('POST /api/decks', () => {
      test('creates a deck', async () => {
        const name = uniqueName('create');
        const deck = await createDeck(name);
        assert.equal(deck.name, name);
      });

      test('rejects an empty deck name', async () => {
        const response = await agent.post('/api/decks').set(authHeaders()).send({ name: '   ' });
        assertError(response, 400, 'Enter a name for the deck.');
      });

      test('treats a duplicate deck name as the same deck regardless of case', async () => {
        const deck = await createDeck(uniqueName('case'));
        const response = await agent
          .post('/api/decks')
          .set(authHeaders())
          .send({ name: deck.name.toUpperCase() });
        assert.equal(response.status, 201);
        assert.equal(response.body.deck.id, deck.id);
        assert.equal(response.body.deck.name, deck.name);
      });
    });

    test.describe('PATCH /api/decks/:id', () => {
      test('rejects an invalid id', async () => {
        const response = await agent.patch('/api/decks/nope').set(authHeaders()).send({ name: uniqueName('rename') });
        assertError(response, 400, 'A valid deck ID is required.');
      });

      test('rejects an empty deck name', async () => {
        const deck = await createDeck();
        const response = await agent.patch(`/api/decks/${deck.id}`).set(authHeaders()).send({ name: '' });
        assertError(response, 400, 'Enter a name for the deck.');
      });

      test('returns 404 when the deck is missing', async () => {
        const response = await agent
          .patch('/api/decks/9223372036854775806')
          .set(authHeaders())
          .send({ name: uniqueName('missing') });
        assertError(response, 404, 'This deck no longer exists.');
      });

      test('rejects a duplicate deck name case-insensitively', async () => {
        const existing = await createDeck(uniqueName('taken'));
        const deck = await createDeck(uniqueName('other'));
        const response = await agent
          .patch(`/api/decks/${deck.id}`)
          .set(authHeaders())
          .send({ name: `  ${existing.name.toUpperCase()}  ` });
        assertError(response, 409, 'A deck with that name already exists.');
      });

      test('renames a deck and the cards that use its name', async () => {
        const deck = await createDeck();
        const card = await createCard(deck.id, 'What is a deck?', 'A named set of cards.');
        const renamed = uniqueName('renamed');
        const response = await agent.patch(`/api/decks/${deck.id}`).set(authHeaders()).send({ name: renamed });
        assert.equal(response.status, 200);
        assert.deepEqual(Object.keys(response.body).sort(), ['deck']);
        assert.equal(response.body.deck.id, deck.id);
        assert.equal(response.body.deck.name, renamed);
        assert.equal(typeof response.body.deck.created_at, 'string');

        const cards = await agent.get('/api/cards').set(authHeaders());
        const updated = cards.body.cards.find(item => item.id === card.id);
        assert.equal(updated.topic, renamed);
        assert.equal(updated.subject, renamed);
      });
    });

    test.describe('DELETE /api/decks/:id', () => {
      test('rejects an invalid id', async () => {
        const response = await agent.delete('/api/decks/nope').set(authHeaders()).send({});
        assertError(response, 400, 'A valid deck ID is required.');
      });

      test('returns 404 when the deck is missing', async () => {
        const response = await agent.delete('/api/decks/9223372036854775806').set(authHeaders()).send({});
        assertError(response, 404, 'This deck no longer exists.');
      });

      test('deletes a deck and its cards', async () => {
        const deck = await createDeck();
        const card = await createCard(deck.id, 'Delete me?', 'Yes.');
        const response = await agent.delete(`/api/decks/${deck.id}`).set(authHeaders()).send({});
        assert.equal(response.status, 204);
        assert.deepEqual(response.body, {});

        const decks = await agent.get('/api/decks').set(authHeaders());
        assert.equal(decks.body.decks.some(item => item.id === deck.id), false);
        const cards = await agent.get('/api/cards').set(authHeaders());
        assert.equal(cards.body.cards.some(item => item.id === card.id), false);
      });
    });

    test.describe('GET /api/cards', () => {
      test('returns saved cards and omits soft-deleted cards', async () => {
        const deck = await createDeck();
        const visible = await createCard(deck.id, 'Visible question', 'Visible answer');
        const hidden = await createCard(deck.id, 'Hidden question', 'Hidden answer');
        const removed = await agent.delete(`/api/cards/${hidden.id}`).set(authHeaders()).send({});
        assert.equal(removed.status, 204);

        const response = await agent.get('/api/cards').set(authHeaders());
        assert.equal(response.status, 200);
        assert.deepEqual(Object.keys(response.body).sort(), ['cards']);
        assert.ok(Array.isArray(response.body.cards));
        const listed = response.body.cards.find(item => item.id === visible.id);
        assert.ok(listed);
        assertCardShape(listed);
        assert.equal(response.body.cards.some(item => item.id === hidden.id), false);
      });
    });

    test.describe('POST /api/cards', () => {
      test('creates a card in a deck', async () => {
        const deck = await createDeck();
        const card = await createCard(deck.id, 'Capital of France?', 'Paris');
        assert.equal(card.topic, deck.name);
        assert.equal(card.subject, deck.name);
        assert.equal(card.format, 'basic');
        assert.equal(card.unit, '');
        assert.equal(card.aiGenerated, false);
        assert.equal(card.mastered, false);
        assert.equal(card.interval_days, 0);
        assert.equal(card.repetitions, 0);
      });

      test('rejects an empty card, an invalid deck id, and a missing deck', async () => {
        const empty = await agent.post('/api/cards').set(authHeaders()).send({ front: '   ', back: 'Answer' });
        assertError(empty, 400, 'Card text must be non-empty and within the supported length.');

        const invalidDeck = await agent.post('/api/cards').set(authHeaders()).send({
          deck_id: 'nope',
          front: 'Question',
          back: 'Answer'
        });
        assertError(invalidDeck, 400, 'A valid deck ID is required.');

        const missingDeck = await agent.post('/api/cards').set(authHeaders()).send({
          deck_id: '9223372036854775806',
          front: 'Question',
          back: 'Answer'
        });
        assertError(missingDeck, 404, 'This deck no longer exists.');
      });
    });

    test.describe('PATCH /api/cards/:id', () => {
      test('rejects an invalid id', async () => {
        const deck = await createDeck();
        const response = await agent.patch('/api/cards/nope').set(authHeaders()).send({
          deck_id: deck.id,
          front: 'Question',
          back: 'Answer'
        });
        assertError(response, 400, 'A valid card ID is required.');
      });

      test('returns 404 when the deck or card is missing', async () => {
        const deck = await createDeck();
        const missingDeck = await agent.patch('/api/cards/9223372036854775806').set(authHeaders()).send({
          deck_id: '9223372036854775806',
          front: 'Question',
          back: 'Answer'
        });
        assertError(missingDeck, 404, 'This deck no longer exists.');

        const missingCard = await agent.patch('/api/cards/9223372036854775806').set(authHeaders()).send({
          deck_id: deck.id,
          front: 'Question',
          back: 'Answer'
        });
        assertError(missingCard, 404, 'This flashcard no longer exists.');
      });

      test('updates a card', async () => {
        const deck = await createDeck();
        const nextDeck = await createDeck();
        const card = await createCard(deck.id, 'Old question', 'Old answer');
        const response = await agent.patch(`/api/cards/${card.id}`).set(authHeaders()).send({
          deck_id: nextDeck.id,
          front: 'New question',
          back: 'New answer',
          unit: 'Chapter 1',
          format: 'definition',
          mastered: true
        });
        assert.equal(response.status, 200);
        assert.deepEqual(Object.keys(response.body).sort(), ['card']);
        assertCardShape(response.body.card);
        assert.equal(response.body.card.id, card.id);
        assert.equal(response.body.card.deck_id, nextDeck.id);
        assert.equal(response.body.card.topic, nextDeck.name);
        assert.equal(response.body.card.front, 'New question');
        assert.equal(response.body.card.back, 'New answer');
        assert.equal(response.body.card.unit, 'Chapter 1');
        assert.equal(response.body.card.format, 'definition');
        assert.equal(response.body.card.mastered, true);
      });
    });

    test.describe('DELETE /api/cards/:id', () => {
      test('rejects an invalid id', async () => {
        const response = await agent.delete('/api/cards/nope').set(authHeaders()).send({});
        assertError(response, 400, 'A valid card ID is required.');
      });

      test('returns 404 when the card is missing', async () => {
        const response = await agent.delete('/api/cards/9223372036854775806').set(authHeaders()).send({});
        assertError(response, 404, 'This flashcard no longer exists.');
      });

      test('soft-deletes a card and purges it when purge=true', async () => {
        const deck = await createDeck();
        const card = await createCard(deck.id, 'Purge question', 'Purge answer');

        const softDeleted = await agent.delete(`/api/cards/${card.id}`).set(authHeaders()).send({});
        assert.equal(softDeleted.status, 204);

        const deletedAgain = await agent.delete(`/api/cards/${card.id}`).set(authHeaders()).send({});
        assertError(deletedAgain, 404, 'This flashcard no longer exists.');

        const purged = await agent.delete(`/api/cards/${card.id}`).query({ purge: 'true' }).set(authHeaders()).send({});
        assert.equal(purged.status, 204);

        const cards = await agent.get('/api/cards').set(authHeaders());
        assert.equal(cards.body.cards.some(item => item.id === card.id), false);
      });
    });

    test.describe('POST /api/cards/:id/restore', () => {
      test('rejects an invalid id', async () => {
        const response = await agent.post('/api/cards/nope/restore').set(authHeaders()).send({});
        assertError(response, 400, 'A valid card ID is required.');
      });

      test('restores a soft-deleted card and returns 404 after a purge', async () => {
        const deck = await createDeck();
        const card = await createCard(deck.id, 'Restore question', 'Restore answer');
        await agent.delete(`/api/cards/${card.id}`).set(authHeaders()).send({});

        const restored = await agent.post(`/api/cards/${card.id}/restore`).set(authHeaders()).send({});
        assert.equal(restored.status, 204);
        const cards = await agent.get('/api/cards').set(authHeaders());
        assert.equal(cards.body.cards.some(item => item.id === card.id), true);

        await agent.delete(`/api/cards/${card.id}`).query({ purge: 'true' }).set(authHeaders()).send({});
        const afterPurge = await agent.post(`/api/cards/${card.id}/restore`).set(authHeaders()).send({});
        assertError(afterPurge, 404, 'This flashcard can no longer be restored.');
      });
    });

    test.describe('POST /api/cards/import', () => {
      test('rejects a payload that is not a card list', async () => {
        const response = await agent.post('/api/cards/import').set(authHeaders()).send({ cards: { front: 'Q', back: 'A' } });
        assertError(response, 400, 'Import must contain no more than 5000 flashcards.');
      });

      test('imports unique cards and skips duplicates', async () => {
        const deckName = uniqueName('import');
        const first = await agent.post('/api/cards/import').set(authHeaders()).send({
          cards: [
            { front: 'Import one', back: 'Answer one', deck_name: deckName },
            { front: 'Import one', back: 'Answer one', deck_name: deckName },
            { front: 'Import two', back: 'Answer two', deck: deckName }
          ]
        });
        assert.equal(first.status, 201);
        assert.deepEqual(first.body, { imported_count: 2 });

        const second = await agent.post('/api/cards/import').set(authHeaders()).send({
          cards: [
            { front: 'Import one', back: 'Answer one', topic: deckName },
            { front: 'Import two', back: 'Answer two', subject: deckName }
          ]
        });
        assert.equal(second.status, 201);
        assert.deepEqual(second.body, { imported_count: 0 });

        const decks = await agent.get('/api/decks').set(authHeaders());
        const deck = decks.body.decks.find(item => item.name === deckName);
        assert.ok(deck);
        assert.equal(deck.total_cards, 2);
        assert.equal(deck.due_count, 2);

        const cards = await agent.get('/api/cards').set(authHeaders());
        const imported = cards.body.cards.filter(card => card.deck_id === deck.id);
        assert.deepEqual(imported.map(card => card.front).sort(), ['Import one', 'Import two']);
        assert.ok(imported.every(card => card.topic === deckName));
      });
    });

    test.describe('POST /api/cards/save', () => {
      test('rejects a missing deck and an empty selection', async () => {
        const missingChoice = await agent.post('/api/cards/save').set(authHeaders()).send({
          cards: [{ front: 'Question', back: 'Answer' }]
        });
        assertError(missingChoice, 400, 'Choose a deck for these flashcards.');

        const deck = await createDeck();
        const emptySelection = await agent.post('/api/cards/save').set(authHeaders()).send({
          deck_id: deck.id,
          cards: []
        });
        assertError(emptySelection, 400, 'Select between 1 and 15 cards to save.');

        const missingDeck = await agent.post('/api/cards/save').set(authHeaders()).send({
          deck_id: '9223372036854775806',
          cards: [{ front: 'Question', back: 'Answer' }]
        });
        assertError(missingDeck, 404, 'This deck no longer exists.');
      });

      test('saves unique cards into an existing deck or a topic deck', async () => {
        const deck = await createDeck();
        const saved = await agent.post('/api/cards/save').set(authHeaders()).send({
          deck_id: deck.id,
          cards: [
            { front: 'Save one', back: 'Answer one' },
            { front: '  Save one  ', back: 'Different answer' },
            { front: 'Save two', back: 'Answer two' }
          ]
        });
        assert.equal(saved.status, 201);
        assert.deepEqual(Object.keys(saved.body).sort(), ['cards']);
        assert.equal(saved.body.cards.length, 2);
        saved.body.cards.forEach(assertCardShape);
        assert.deepEqual(saved.body.cards.map(card => card.front), ['Save one', 'Save two']);
        assert.ok(saved.body.cards.every(card => card.deck_id === deck.id && card.topic === deck.name));

        const topic = uniqueName('topic');
        const byTopic = await agent.post('/api/cards/save').set(authHeaders()).send({
          topic,
          cards: [{ front: 'Topic question', back: 'Topic answer' }]
        });
        assert.equal(byTopic.status, 201);
        assert.equal(byTopic.body.cards.length, 1);
        assert.equal(byTopic.body.cards[0].topic, topic);
        assertCardShape(byTopic.body.cards[0]);
      });
    });

    test.describe('GET /api/review/next', () => {
      test('rejects an invalid limit and an invalid deck id', async () => {
        const badLimit = await agent.get('/api/review/next').query({ limit: 0 }).set(authHeaders());
        assertError(badLimit, 400, 'Review limit must be a positive whole number.');

        const badDeck = await agent.get('/api/review/next').query({ deck_id: 'nope' }).set(authHeaders());
        assertError(badDeck, 400, 'A valid deck ID is required.');
      });

      test('returns due cards for a deck up to the requested limit', async () => {
        const deck = await createDeck();
        const other = await createDeck();
        const first = await createCard(deck.id, 'Due one', 'Answer one');
        const second = await createCard(deck.id, 'Due two', 'Answer two');
        await createCard(deck.id, 'Due three', 'Answer three');
        await createCard(other.id, 'Other deck', 'Other answer');

        const response = await agent.get('/api/review/next').query({ limit: 2, deck_id: deck.id }).set(authHeaders());
        assert.equal(response.status, 200);
        assert.deepEqual(Object.keys(response.body).sort(), ['cards', 'total_due']);
        assert.equal(response.body.total_due, 3);
        assert.equal(response.body.cards.length, 2);
        response.body.cards.forEach(assertCardShape);
        assert.deepEqual(response.body.cards.map(card => card.id), [first.id, second.id]);
        assert.ok(response.body.cards.every(card => card.deck_id === deck.id));
      });
    });

    test.describe('POST /api/review/grade', () => {
      test('rejects an invalid card id and a missing card', async () => {
        const invalid = await agent.post('/api/review/grade').set(authHeaders()).send({
          card_id: 'nope',
          user_answer: ''
        });
        assertError(invalid, 400, 'A valid card ID is required.');

        const missing = await agent.post('/api/review/grade').set(authHeaders()).send({
          card_id: '9223372036854775806',
          user_answer: ''
        });
        assertError(missing, 404, 'This flashcard no longer exists.');
      });

      test('schedules a blank answer without calling the model', async () => {
        const deck = await createDeck();
        const card = await createCard(deck.id, 'Graded question', 'Graded answer');
        const response = await agent.post('/api/review/grade').set(authHeaders()).send({
          card_id: card.id,
          user_answer: '   ',
          response_ms: 1500
        });
        assert.equal(response.status, 200);
        assert.deepEqual(Object.keys(response.body).sort(), ['correct_answer', 'feedback', 'next_due_at', 'score']);
        assert.equal(response.body.score, 0);
        assert.equal(response.body.feedback, 'No answer was provided.');
        assert.equal(response.body.correct_answer, 'Graded answer');
        assert.equal(typeof response.body.next_due_at, 'string');
        assert.ok(Date.parse(response.body.next_due_at) > Date.now());

        const cards = await agent.get('/api/cards').set(authHeaders());
        const updated = cards.body.cards.find(item => item.id === card.id);
        assert.equal(updated.interval_days, 1);
        assert.equal(updated.repetitions, 0);

        const due = await agent.get('/api/review/next').query({ deck_id: deck.id, limit: 10 }).set(authHeaders());
        assert.equal(due.body.total_due, 0);
        assert.deepEqual(due.body.cards, []);
      });
    });

    test.describe('GET /api/stats/topics', () => {
      test('returns deck totals and daily review activity', async () => {
        const deck = await createDeck();
        const card = await createCard(deck.id, 'Stats question', 'Stats answer');
        const graded = await agent.post('/api/review/grade').set(authHeaders()).send({
          card_id: card.id,
          user_answer: ''
        });
        assert.equal(graded.status, 200);

        const response = await agent.get('/api/stats/topics').set(authHeaders());
        assert.equal(response.status, 200);
        assert.deepEqual(Object.keys(response.body).sort(), ['activity', 'decks', 'topics']);
        assert.deepEqual(response.body.topics, response.body.decks);
        const listed = response.body.decks.find(item => item.deck_id === deck.id);
        assert.ok(listed);
        assert.deepEqual(
          Object.keys(listed).sort(),
          ['average_score_30d', 'deck', 'deck_id', 'due_count', 'recent_review_count', 'review_count', 'total_cards', 'weak']
        );
        assert.equal(listed.deck, deck.name);
        assert.equal(listed.total_cards, 1);
        assert.equal(listed.due_count, 0);
        assert.equal(listed.review_count, 1);
        assert.equal(listed.recent_review_count, 1);
        assert.equal(Number(listed.average_score_30d), 0);
        assert.equal(listed.weak, false);

        assert.equal(response.body.activity.length, 14);
        response.body.activity.forEach(day => {
          assert.deepEqual(Object.keys(day).sort(), ['day', 'reviews']);
          assert.match(day.day, /^\d{4}-\d{2}-\d{2}$/);
          assert.equal(typeof day.reviews, 'number');
        });
        assert.ok(response.body.activity.some(day => day.reviews >= 1));
      });
    });

    test.describe('assignment brief database routes', () => {
      const BRIEF_KEYS = [
        'assignment_data', 'assignment_id', 'brief_document_id', 'brief_extracted_text',
        'brief_file_name', 'brief_file_size', 'brief_mime_type', 'brief_status',
        'created_at', 'updated_at'
      ];

      function sampleAssignment(assignmentId) {
        return {
          id: assignmentId,
          title: 'Integration brief assignment',
          classId: 'class-1',
          dueAt: Date.UTC(2026, 5, 1),
          details: 'Read the brief and submit answers.',
          completed: false
        };
      }

      async function savePastedBrief(assignmentId = uniqueName('assignment'), overrides = {}) {
        const documentId = uniqueName('doc');
        const assignment = sampleAssignment(assignmentId);
        const payload = {
          assignment,
          documentId,
          extractedText: 'Pasted assignment brief text.',
          sourceType: 'paste',
          fileName: 'brief.txt',
          fileType: 'text/plain',
          fileSize: 0,
          ...overrides
        };
        const response = await agent
          .put(`/api/assignments/${assignmentId}/brief`)
          .set(authHeaders())
          .send(payload);
        return { response, assignmentId, documentId, assignment, payload };
      }

      test.describe('GET /api/assignments/briefs', () => {
        test('requires an authenticated session', async () => {
          const response = await request(app).get('/api/assignments/briefs');
          assertError(response, 401, 'Authentication required.');
        });

        test('returns saved briefs for the owner', async () => {
          const { response: saved, assignmentId } = await savePastedBrief();
          assert.equal(saved.status, 200);

          const response = await agent.get('/api/assignments/briefs').set(authHeaders());
          assert.equal(response.status, 200);
          assert.deepEqual(Object.keys(response.body).sort(), ['briefs']);
          assert.ok(Array.isArray(response.body.briefs));
          const listed = response.body.briefs.find(item => item.assignment_id === assignmentId);
          assert.ok(listed);
          assert.deepEqual(Object.keys(listed).sort(), BRIEF_KEYS);
          assert.equal(listed.brief_document_id, saved.body.brief.brief_document_id);
          assert.equal(listed.brief_file_name, 'brief.txt');
          assert.equal(listed.brief_mime_type, 'text/plain');
          assert.equal(Number(listed.brief_file_size), 0);
          assert.equal(listed.brief_extracted_text, 'Pasted assignment brief text.');
          assert.equal(listed.brief_status, 'ready');
        });
      });

      test.describe('PUT /api/assignments/:assignmentId/brief/validate', () => {
        test('requires an authenticated session', async () => {
          const response = await request(app)
            .put('/api/assignments/itest-assignment/brief/validate')
            .set({
              'Content-Type': 'application/octet-stream',
              'X-Requested-With': 'StudyBuddy'
            })
            .send(Buffer.from('hello brief'));
          assertError(response, 401, 'Authentication required.');
        });

        test('validates a text brief upload and returns file metadata', async () => {
          const assignmentId = uniqueName('assignment');
          const documentId = uniqueName('doc');
          const body = Buffer.from('Validated brief contents.');
          const response = await agent
            .put(`/api/assignments/${assignmentId}/brief/validate`)
            .set(authHeaders())
            .set('Content-Type', 'application/octet-stream')
            .set('X-Upload-Filename', encodeURIComponent('notes.txt'))
            .set('X-Document-ID', documentId)
            .set('X-Upload-Mime-Type', 'text/plain')
            .send(body);
          assert.equal(response.status, 200);
          assert.deepEqual(response.body, {
            fileName: 'notes.txt',
            fileType: 'text/plain',
            fileSize: body.length
          });
        });

        test('rejects unsupported brief file types', async () => {
          const response = await agent
            .put(`/api/assignments/${uniqueName('assignment')}/brief/validate`)
            .set(authHeaders())
            .set('Content-Type', 'application/octet-stream')
            .set('X-Upload-Filename', encodeURIComponent('notes.exe'))
            .set('X-Document-ID', uniqueName('doc'))
            .send(Buffer.from('not a supported brief'));
          assertError(response, 400, 'Supported brief files are PDF, DOCX, TXT, JPG, PNG, GIF, and WEBP.');
        });
      });

      test.describe('PUT /api/assignments/:assignmentId/brief', () => {
        test('requires an authenticated session', async () => {
          const assignmentId = uniqueName('assignment');
          const response = await request(app)
            .put(`/api/assignments/${assignmentId}/brief`)
            .set({
              'Content-Type': 'application/json',
              'X-Requested-With': 'StudyBuddy'
            })
            .send({
              assignment: sampleAssignment(assignmentId),
              documentId: uniqueName('doc'),
              extractedText: 'text',
              sourceType: 'paste',
              fileName: 'brief.txt',
              fileType: 'text/plain',
              fileSize: 0
            });
          assertError(response, 401, 'Authentication required.');
        });

        test('saves a pasted brief', async () => {
          const { response, assignmentId, documentId, assignment } = await savePastedBrief();
          assert.equal(response.status, 200);
          assert.deepEqual(Object.keys(response.body).sort(), ['brief']);
          assert.deepEqual(Object.keys(response.body.brief).sort(), BRIEF_KEYS);
          assert.equal(response.body.brief.assignment_id, assignmentId);
          assert.equal(response.body.brief.brief_document_id, documentId);
          assert.deepEqual(response.body.brief.assignment_data, assignment);
          assert.equal(response.body.brief.brief_file_name, 'brief.txt');
          assert.equal(response.body.brief.brief_mime_type, 'text/plain');
          assert.equal(Number(response.body.brief.brief_file_size), 0);
          assert.equal(response.body.brief.brief_extracted_text, 'Pasted assignment brief text.');
          assert.equal(response.body.brief.brief_status, 'ready');
          assert.equal(typeof response.body.brief.created_at, 'string');
          assert.equal(typeof response.body.brief.updated_at, 'string');
        });

        test('rejects invalid assignment details', async () => {
          const assignmentId = uniqueName('assignment');
          const response = await agent
            .put(`/api/assignments/${assignmentId}/brief`)
            .set(authHeaders())
            .send({
              assignment: { ...sampleAssignment(assignmentId), completed: 'no' },
              documentId: uniqueName('doc'),
              extractedText: 'text',
              sourceType: 'paste',
              fileName: 'brief.txt',
              fileType: 'text/plain',
              fileSize: 0
            });
          assertError(response, 400, 'Assignment details are invalid.');
        });

        test('requires a validated upload before saving a file brief', async () => {
          const assignmentId = uniqueName('assignment');
          const response = await agent
            .put(`/api/assignments/${assignmentId}/brief`)
            .set(authHeaders())
            .send({
              assignment: sampleAssignment(assignmentId),
              documentId: uniqueName('doc'),
              extractedText: 'file brief text',
              sourceType: 'file',
              fileName: 'brief.txt',
              fileType: 'text/plain',
              fileSize: 12
            });
          assertError(response, 400, 'Validate the selected brief file before saving it.');
        });

        test('saves a validated file brief', async () => {
          const assignmentId = uniqueName('assignment');
          const documentId = uniqueName('doc');
          const body = Buffer.from('Uploaded brief contents.');
          const validated = await agent
            .put(`/api/assignments/${assignmentId}/brief/validate`)
            .set(authHeaders())
            .set('Content-Type', 'application/octet-stream')
            .set('X-Upload-Filename', encodeURIComponent('brief.txt'))
            .set('X-Document-ID', documentId)
            .set('X-Upload-Mime-Type', 'text/plain')
            .send(body);
          assert.equal(validated.status, 200);

          const response = await agent
            .put(`/api/assignments/${assignmentId}/brief`)
            .set(authHeaders())
            .send({
              assignment: sampleAssignment(assignmentId),
              documentId,
              extractedText: 'Uploaded brief contents.',
              sourceType: 'file',
              fileName: 'brief.txt',
              fileType: 'text/plain',
              fileSize: body.length
            });
          assert.equal(response.status, 200);
          assert.equal(response.body.brief.brief_document_id, documentId);
          assert.equal(response.body.brief.brief_file_name, 'brief.txt');
          assert.equal(response.body.brief.brief_mime_type, 'text/plain');
          assert.equal(Number(response.body.brief.brief_file_size), body.length);
          assert.equal(response.body.brief.brief_extracted_text, 'Uploaded brief contents.');
          assert.equal(response.body.brief.brief_status, 'ready');
        });
      });

      test.describe('DELETE /api/assignments/:assignmentId/brief', () => {
        test('requires an authenticated session', async () => {
          const response = await request(app)
            .delete('/api/assignments/itest-assignment/brief')
            .set({
              'Content-Type': 'application/json',
              'X-Requested-With': 'StudyBuddy'
            })
            .send({});
          assertError(response, 401, 'Authentication required.');
        });

        test('clears brief fields while keeping the workspace row', async () => {
          const { response: saved, assignmentId, documentId } = await savePastedBrief();
          assert.equal(saved.status, 200);
          assert.equal(saved.body.brief.brief_document_id, documentId);

          const removed = await agent
            .delete(`/api/assignments/${assignmentId}/brief`)
            .set(authHeaders())
            .send({});
          assert.equal(removed.status, 204);

          const listed = await agent.get('/api/assignments/briefs').set(authHeaders());
          assert.equal(listed.status, 200);
          const brief = listed.body.briefs.find(item => item.assignment_id === assignmentId);
          assert.ok(brief);
          assert.equal(brief.brief_document_id, null);
          assert.equal(brief.brief_file_name, null);
          assert.equal(brief.brief_mime_type, null);
          assert.equal(brief.brief_file_size, null);
          assert.equal(brief.brief_extracted_text, null);
          assert.equal(brief.brief_status, 'ready');
          assert.deepEqual(brief.assignment_data, saved.body.brief.assignment_data);
        });

        test('rejects an invalid assignment ID', async () => {
          const response = await agent
            .delete('/api/assignments/bad@id/brief')
            .set(authHeaders())
            .send({});
          assertError(response, 400, 'A valid assignment ID is required.');
        });
      });
    });
  });
}
