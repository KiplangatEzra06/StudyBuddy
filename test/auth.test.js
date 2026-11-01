const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/studybuddy?sslmode=require';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync('secret-password', 12);
process.env.SESSION_SECRET = 'test-session-secret-that-is-at-least-32-chars';

const app = require('../server');

function authHeaders(ip = '127.0.0.1') {
  return {
    'Content-Type': 'application/json',
    'X-Requested-With': 'StudyBuddy',
    'X-Forwarded-For': ip
  };
}

test('POST /api/auth/login succeeds with the correct credentials', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .set(authHeaders('203.0.113.10'))
    .send({ username: 'admin', password: 'secret-password' });

  assert.equal(response.status, 200);
  assert.equal(response.body.authenticated, true);
});

test('wrong password yields the same generic 401 response as a wrong username', async () => {
  const wrongPassword = await request(app)
    .post('/api/auth/login')
    .set(authHeaders('203.0.113.11'))
    .send({ username: 'admin', password: 'wrong-password' });

  const wrongUsername = await request(app)
    .post('/api/auth/login')
    .set(authHeaders('203.0.113.12'))
    .send({ username: 'not-admin', password: 'secret-password' });

  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongUsername.status, 401);
  assert.equal(wrongPassword.body.error, 'Incorrect username or password');
  assert.equal(wrongUsername.body.error, 'Incorrect username or password');
});

test('rate limiting blocks repeated login failures after the fifth attempt', async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await request(app)
      .post('/api/auth/login')
      .set(authHeaders('198.51.100.20'))
      .send({ username: 'admin', password: 'wrong-password' });

    if (attempt < 4) {
      assert.equal(response.status, 401);
    }
  }

  const blocked = await request(app)
    .post('/api/auth/login')
    .set(authHeaders('198.51.100.20'))
    .send({ username: 'admin', password: 'wrong-password' });

  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /15 minutes/i);
});

test('GET /api/health requires an authenticated session', async () => {
  const response = await request(app)
    .get('/api/health');

  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'Authentication required.');
});

test('POST /api/auth/logout invalidates the current session', async () => {
  const agent = request.agent(app);

  const login = await agent
    .post('/api/auth/login')
    .set(authHeaders('198.51.100.21'))
    .send({ username: 'admin', password: 'secret-password' });

  assert.equal(login.status, 200);

  const logout = await agent
    .post('/api/auth/logout')
    .set(authHeaders('198.51.100.21'))
    .send({});

  assert.equal(logout.status, 204);

  const me = await agent.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.authenticated, false);
});
