const { ownerIdForUsername } = require('../services/owner-id');

function requireJsonCsrf(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const isAssignmentBriefFileUpload = req.method === 'PUT'
    && /^\/api\/assignments\/[A-Za-z0-9_-]+\/brief\/validate$/.test(req.originalUrl.split('?')[0])
    && req.is('application/octet-stream');
  if (isAssignmentBriefFileUpload) {
    if (req.get('X-Requested-With') !== 'StudyBuddy') {
      return res.status(403).json({ error: 'Request could not be verified.' });
    }
    return next();
  }
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Requests must use application/json.' });
  }
  if (req.get('X-Requested-With') !== 'StudyBuddy') {
    return res.status(403).json({ error: 'Request could not be verified.' });
  }
  next();
}

function requireAuth(req, res, next) {
  if (req.session?.authenticated === true) {
    req.session.ownerId ||= ownerIdForUsername(process.env.ADMIN_USERNAME);
    return next();
  }
  return res.status(401).json({ error: 'Authentication required.' });
}

module.exports = { requireAuth, requireJsonCsrf };
