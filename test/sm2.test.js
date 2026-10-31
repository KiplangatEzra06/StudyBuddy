const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateSm2, qualityForScore } = require('../sm2');

const now = new Date('2026-10-31T12:00:00.000Z');
const newCard = { repetitions: 0, interval_days: 0, ease_factor: 2.5 };

test('maps score ranges to SM-2 quality', () => {
  assert.deepEqual([0, 20, 40, 60, 75, 90].map(qualityForScore), [0, 1, 2, 3, 4, 5]);
  assert.throws(() => qualityForScore(101), RangeError);
});

test('a failed review resets repetitions and schedules one day later', () => {
  const result = calculateSm2({ repetitions: 4, interval_days: 30, ease_factor: 2.1 }, 2, now);
  assert.equal(result.repetitions, 0);
  assert.equal(result.interval_days, 1);
  assert.equal(result.due_at.toISOString(), '2026-11-01T12:00:00.000Z');
});

test('first successful review schedules one day later', () => {
  const result = calculateSm2(newCard, 4, now);
  assert.equal(result.repetitions, 1);
  assert.equal(result.interval_days, 1);
});

test('second successful review schedules six days later', () => {
  const result = calculateSm2({ ...newCard, repetitions: 1, interval_days: 1 }, 4, now);
  assert.equal(result.repetitions, 2);
  assert.equal(result.interval_days, 6);
});

test('third successful review multiplies the prior interval by ease', () => {
  const result = calculateSm2({ ...newCard, repetitions: 2, interval_days: 6 }, 4, now);
  assert.equal(result.repetitions, 3);
  assert.equal(result.interval_days, 15);
});

test('ease factor never drops below 1.3', () => {
  const result = calculateSm2({ ...newCard, ease_factor: 1.3 }, 0, now);
  assert.equal(result.ease_factor, 1.3);
});
