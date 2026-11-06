const crypto = require('crypto');

function ownerIdForUsername(username) {
  const normalized = String(username || '').trim().toLowerCase();
  return `admin:${crypto.createHash('sha256').update(normalized).digest('hex')}`;
}

module.exports = { ownerIdForUsername };
