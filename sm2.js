function qualityForScore(score) {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new RangeError('Score must be an integer from 0 to 100.');
  }
  if (score < 20) return 0;
  if (score < 40) return 1;
  if (score < 60) return 2;
  if (score < 75) return 3;
  if (score < 90) return 4;
  return 5;
}

function calculateSm2(card, quality, reviewedAt = new Date()) {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) {
    throw new RangeError('Quality must be an integer from 0 to 5.');
  }

  const previousRepetitions = Number(card.repetitions) || 0;
  const previousInterval = Number(card.interval_days) || 0;
  const previousEase = Number(card.ease_factor) || 2.5;
  const repetitions = quality < 3 ? 0 : previousRepetitions + 1;
  const intervalDays = quality < 3
    ? 1
    : repetitions === 1
      ? 1
      : repetitions === 2
        ? 6
        : Math.round(previousInterval * previousEase);
  const easeFactor = Math.max(
    1.3,
    previousEase + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
  );
  const dueAt = new Date(reviewedAt.getTime() + intervalDays * 24 * 60 * 60 * 1000);

  return {
    repetitions,
    interval_days: intervalDays,
    ease_factor: easeFactor,
    due_at: dueAt
  };
}

module.exports = { calculateSm2, qualityForScore };
