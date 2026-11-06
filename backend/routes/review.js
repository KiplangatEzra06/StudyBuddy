const express = require('express');
const { getNextReview, gradeReview, getTopicStats } = require('../controllers/review');

function createReviewRouter() {
  const router = express.Router();
  router.get('/api/review/next', getNextReview);
  router.post('/api/review/grade', gradeReview);
  router.get('/api/stats/topics', getTopicStats);
  return router;
}

module.exports = createReviewRouter;
