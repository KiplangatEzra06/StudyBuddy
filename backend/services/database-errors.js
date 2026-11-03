function databaseFailure(res, operation, error) {
  if (error) {
    console.error(`Study database ${operation} failed`, {
      code: error.code || 'unknown',
      status: error.status || 0
    });
  }
  return res.status(503).json({
    error: `The study database is waking up or temporarily unavailable. Please try ${operation} again.`
  });
}

module.exports = { databaseFailure };
