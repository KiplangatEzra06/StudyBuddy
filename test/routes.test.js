const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://localhost:5432/studybuddy?sslmode=require';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync('secret-password', 12);
process.env.SESSION_SECRET = 'test-session-secret-that-is-at-least-32-chars';

const app = require('../server');

test('extracted routes and frontend modules are mounted correctly', async () => {
  const agent = request.agent(app);
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'StudyBuddy',
    'X-Forwarded-For': '203.0.113.31'
  };
  const login = await agent
    .post('/api/auth/login')
    .set(headers)
    .send({ username: 'admin', password: 'secret-password' });

  assert.equal(login.status, 200);

  const ai = await agent
    .post('/api/ai')
    .set(headers)
    .send({});
  assert.equal(ai.status, 400);
  assert.equal(ai.body.error, 'A question is required.');

  const cards = await agent
    .post('/api/cards')
    .set(headers)
    .send({ front: null, back: '' });
  assert.equal(cards.status, 400);
  assert.equal(cards.body.error, 'Each card needs a question and an answer.');

  const review = await agent
    .post('/api/review/grade')
    .set(headers)
    .send({ card_id: 'invalid', user_answer: '' });
  assert.equal(review.status, 400);
  assert.equal(review.body.error, 'A valid card ID is required.');

  const calendarModule = await request(app).get('/frontend/features/calendar-data.js');
  assert.equal(calendarModule.status, 200);
  assert.match(calendarModule.headers['content-type'], /javascript/);
  assert.match(calendarModule.text, /export function getNextCalendarEvent/);

  const backupModule = await request(app).get('/frontend/features/backup-data.js');
  assert.equal(backupModule.status, 200);
  assert.match(backupModule.headers['content-type'], /javascript/);
  assert.match(backupModule.text, /export function validateBackup/);
});
