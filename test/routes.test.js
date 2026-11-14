const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const http = require('node:http');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://localhost:5432/studybuddy?sslmode=require';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync('secret-password', 12);
process.env.SESSION_SECRET = 'test-session-secret-that-is-at-least-32-chars';

const app = require('../server');
const { generate } = require('../backend/services/ai');

test('AI client rebinds when provider settings change', async () => {
  const serverOneRequests = [];
  const serverTwoRequests = [];

  const serverOne = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    serverOneRequests.push(JSON.parse(body));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'from-server-one' } }] }));
  });
  const serverTwo = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    serverTwoRequests.push(JSON.parse(body));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'from-server-two' } }] }));
  });

  await new Promise(resolve => serverOne.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => serverTwo.listen(0, '127.0.0.1', resolve));

  const originalBaseUrl = process.env.AI_BASE_URL;
  const originalApiKey = process.env.AI_API_KEY;
  const originalModel = process.env.AI_MODEL;
  const originalFallbackModels = process.env.AI_FALLBACK_MODELS;

  try {
    process.env.AI_BASE_URL = `http://127.0.0.1:${serverOne.address().port}/v1`;
    process.env.AI_API_KEY = 'first-key';
    process.env.AI_MODEL = 'model-one';
    process.env.AI_FALLBACK_MODELS = '';

    const firstResult = await generate({ messages: [{ role: 'user', content: 'first question' }], maxTokens: 32 });
    assert.equal(firstResult, 'from-server-one');
    assert.equal(serverOneRequests.length, 1);
    assert.equal(serverTwoRequests.length, 0);

    process.env.AI_BASE_URL = `http://127.0.0.1:${serverTwo.address().port}/v1`;
    process.env.AI_API_KEY = 'second-key';
    process.env.AI_MODEL = 'model-two';
    process.env.AI_FALLBACK_MODELS = '';

    const secondResult = await generate({ messages: [{ role: 'user', content: 'second question' }], maxTokens: 32 });
    assert.equal(secondResult, 'from-server-two');
    assert.equal(serverTwoRequests.length, 1);
    assert.equal(serverOneRequests.length, 1);
  } finally {
    if (originalBaseUrl === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = originalBaseUrl;
    if (originalApiKey === undefined) delete process.env.AI_API_KEY; else process.env.AI_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = originalModel;
    if (originalFallbackModels === undefined) delete process.env.AI_FALLBACK_MODELS; else process.env.AI_FALLBACK_MODELS = originalFallbackModels;

    await new Promise((resolve, reject) => {
      serverOne.close(error => error ? reject(error) : resolve());
    });
    await new Promise((resolve, reject) => {
      serverTwo.close(error => error ? reject(error) : resolve());
    });
  }
});

test('extracted routes and frontend modules are mounted correctly', async () => {
  const unauthenticatedHealth = await request(app).get('/api/ai/health');
  assert.equal(unauthenticatedHealth.status, 401);
  assert.equal(unauthenticatedHealth.body.error, 'Authentication required.');

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

  const aiRequests = [];
  let aiResponses = ['OK'];
  let aiResponseIndex = 0;
  const mockAiServer = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    aiRequests.push(JSON.parse(body));
    const content = aiResponses[Math.min(aiResponseIndex++, aiResponses.length - 1)];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise(resolve => mockAiServer.listen(0, '127.0.0.1', resolve));
  process.env.AI_BASE_URL = `http://127.0.0.1:${mockAiServer.address().port}/v1`;
  process.env.AI_API_KEY = 'test-ai-key';
  process.env.AI_MODEL = 'health-test-model';
  process.env.AI_FALLBACK_MODELS = '';
  try {
    const health = await agent.get('/api/ai/health').set(headers);
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: 'ok', model: 'health-test-model' });
    assert.deepEqual(aiRequests[0].messages, [
      { role: 'user', content: 'Reply with exactly the word OK on one line.' }
    ]);

    aiResponses = [
      'Try the first step.\n\n```answer_table\n{"title":"Trace","columns":["Input"],"rows":[{"label":"Step 1","cells":["","extra"]}],"locked_cells":[],"hint":"Apply the rule."}\n```',
      'Try applying the rule to the first step.\n\n```answer_table\n{"title":"Trace","columns":["Input","Output"],"rows":[{"label":"Step 1","cells":["x",""]}],"locked_cells":[[0,0]],"hint":"Apply the rule once."}\n```'
    ];
    aiResponses[1] += '\n<!-- tutor_sources: {"sources":[{"type":"suggested_reading","title":"Official Documentation","detail":"truth tables"}]} -->';
    aiResponseIndex = 0;
    const tutor = await agent.post('/api/ai').set(headers).send({ input: 'Make a trace table.', history: [] });
    assert.equal(tutor.status, 200);
    assert.match(aiRequests[1].messages[0].content, /Begin with a short hint, then give per-cell or per-row feedback/);
    assert.match(aiRequests[1].messages[0].content, /do not create another table or answer_table block/);
    assert.match(aiRequests[1].messages[0].content, /Never provide a replacement or missing answer/);
    assert.match(aiRequests[1].messages[0].content, /end by asking the student to try the table again/);
    assert.match(aiRequests[1].messages[1].content, /exact provided file name as title/);
    assert.match(aiRequests[1].messages[1].content, /no more than 3/);
    assert.match(aiRequests[1].messages[1].content, /URLs, page numbers, ISBNs/);
    assert.equal(tutor.body.reply, 'Try applying the rule to the first step.');
    assert.equal(tutor.body.text, tutor.body.reply);
    assert.deepEqual(tutor.body.answerTable, {
      title: 'Trace',
      columns: ['Input', 'Output'],
      rows: [{ label: 'Step 1', cells: ['x', ''] }],
      locked_cells: [[0, 0]],
      hint: 'Apply the rule once.'
    });
    assert.deepEqual(tutor.body.sources, [{
      type: 'suggested_reading',
      title: 'Official Documentation',
      detail: 'truth tables'
    }]);
    assert.doesNotMatch(tutor.body.text, /tutor_sources|Official Documentation/);
    assert.match(aiRequests[2].messages.at(-1).content, /Fix only the answer_table JSON block/);

    aiResponses = [
      'Unsafe prose\n\n```answer_table\n{"title":"bad"}\n```',
      'Private model error: raw JSON {"answer":"secret"}'
    ];
    aiResponseIndex = 0;
    const fallback = await agent.post('/api/ai').set(headers).send({ input: 'Make a trace table.', history: [] });
    assert.equal(fallback.status, 200);
    assert.equal(fallback.body.answerTable, null);
    assert.match(fallback.body.text, /\| Step \| Your attempt \|/);
    assert.doesNotMatch(fallback.body.text, /Unsafe prose|Private model error|raw JSON|secret/);

    aiResponses = [`The key idea is the rule.

<!-- tutor_sources: {"sources":[{"type":"user_material","title":"Lecture notes.pdf","detail":"Chapter 2"},{"type":"user_material","title":"Missing.pdf","detail":"Unknown"},{"type":"suggested_reading","title":"Official Documentation","detail":"truth tables"}]} -->`];
    aiResponseIndex = 0;
    const validatedSources = await agent.post('/api/ai').set(headers).send({
      input: 'Explain the rule.',
      history: [],
      references: [],
      materials: [{ id: 'note-1', fileName: 'Lecture notes.pdf', sectionLabels: ['Chapter 2'] }]
    });
    assert.equal(validatedSources.status, 200);
    assert.deepEqual(validatedSources.body.sources, [
      { type: 'user_material', title: 'Lecture notes.pdf', detail: 'Chapter 2' },
      { type: 'suggested_reading', title: 'Official Documentation', detail: 'truth tables' }
    ]);
  } finally {
    await new Promise((resolve, reject) => {
      mockAiServer.close(error => error ? reject(error) : resolve());
    });
  }

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

  const stylesheetPaths = [
    'design-tokens.css',
    'styles/base.css',
    'styles/layout.css',
    'styles/dashboard.css',
    'styles/flashcards.css',
    'styles/notes.css',
    'styles/calendar.css',
    'styles/classes.css',
    'styles/documents.css',
    'styles/quiz.css',
    'styles/timer.css',
    'styles/progress.css',
    'styles/tutor.css',
    'styles/settings.css',
    'styles/assignment-workspace.css',
    'components.css'
  ];
  const [page, ...stylesheets] = await Promise.all([
    request(app).get('/'),
    ...stylesheetPaths.map(stylesheet => request(app).get(`/${stylesheet}`))
  ]);
  const tokens = stylesheets[0];
  const components = stylesheets[stylesheets.length - 1];
  assert.equal(tokens.status, 200);
  assert.match(tokens.text, /--color-background/);
  assert.match(tokens.text, /:root\[data-theme="dark"\]/);
  assert.equal(components.status, 200);
  assert.match(components.text, /\.btn\.btn-primary:hover/);
  assert.doesNotMatch(components.text, /\.btn-primary:hover\s*\{[^}]*linear-gradient/s);
  assert.equal(page.status, 200);
  let previousStylesheet = -1;
  for (const stylesheet of stylesheetPaths) {
    assert.equal(stylesheets[stylesheetPaths.indexOf(stylesheet)].status, 200);
    const position = page.text.indexOf(`href="${stylesheet}"`);
    assert.ok(position > previousStylesheet, `${stylesheet} stays in the stylesheet cascade order`);
    previousStylesheet = position;
  }
  for (const group of [
    'WORKSPACE',
    'ACADEMIC PLANNER',
    'STUDY LIBRARY',
    'LEARNING STUDIO',
    'PRODUCTIVITY',
    'INSIGHTS AND SETTINGS'
  ]) {
    assert.ok(page.text.includes(`>${group}</h2>`), `navigation includes the ${group} group`);
  }
  assert.match(page.text, /data-tab="assignments"/);
  assert.match(page.text, /data-tab="sessions"/);
  assert.match(page.text, /id="sidebar-collapse-toggle"/);
  assert.match(page.text, /id="menu-toggle"/);
  for (const section of ['priorities', 'upcoming', 'activity', 'continue', 'progress', 'revision', 'actions']) {
    assert.match(page.text, new RegExp(`id="dashboard-${section}"`));
    assert.match(page.text, new RegExp(`id="dashboard-${section}-loading"`));
    assert.match(page.text, new RegExp(`id="dashboard-${section}-empty"`));
    assert.match(page.text, new RegExp(`id="dashboard-${section}-error"`));
  }
  assert.doesNotMatch(page.text, /class="dashboard-stat-grid"/);
});
