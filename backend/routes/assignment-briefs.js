const express = require('express');
const {
  validateBriefUpload,
  listBriefs,
  saveBrief,
  removeBrief
} = require('../controllers/assignment-briefs');

function createAssignmentBriefRouter() {
  const router = express.Router();
  router.put('/:assignmentId/brief/validate', validateBriefUpload);
  router.get('/briefs', listBriefs);
  router.put('/:assignmentId/brief', saveBrief);
  router.delete('/:assignmentId/brief', removeBrief);
  return router;
}

module.exports = createAssignmentBriefRouter;
