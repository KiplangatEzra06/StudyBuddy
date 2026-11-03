function requireJsonCsrf(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Requests must use application/json.' });
  }
  if (req.get('X-Requested-With') !== 'StudyBuddy') {
    return res.status(403).json({ error: 'Request could not be verified.' });
  }
  next();
}

function requireAuth(req, res, next) {
  if (req.session?.authenticated === true) return next();
  return res.status(401).json({ error: 'Authentication required.' });
}

module.exports = { requireAuth, requireJsonCsrf };
