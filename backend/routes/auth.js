const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');

function createAuthRouter({ loginLimiter, isProduction }) {
  const router = express.Router();
  const unavailablePasswordHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
  const configuredPasswordHash = process.env.ADMIN_PASSWORD_HASH || unavailablePasswordHash;

  function usernamesMatchConstantTime(username) {
    const supplied = crypto.createHash('sha256').update(username).digest();
    const configured = crypto.createHash('sha256').update(process.env.ADMIN_USERNAME || '').digest();
    return crypto.timingSafeEqual(supplied, configured);
  }

  router.post('/login', loginLimiter, async (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    let passwordMatches = false;
    try {
      passwordMatches = await bcrypt.compare(password, configuredPasswordHash);
    } catch {
      passwordMatches = false;
    }
    const usernameMatches = usernamesMatchConstantTime(username);
    const credentialsConfigured = Boolean(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD_HASH);
    if (!credentialsConfigured || !usernameMatches || !passwordMatches) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }
    req.session.regenerate(error => {
      if (error) {
        console.error('Could not establish authenticated session.');
        return res.status(500).json({ error: 'Could not sign in right now. Please try again.' });
      }
      req.session.authenticated = true;
      req.session.save(saveError => {
        if (saveError) {
          console.error('Could not save authenticated session.');
          return res.status(500).json({ error: 'Could not sign in right now. Please try again.' });
        }
        res.json({ authenticated: true });
      });
    });
  });

  router.post('/logout', (req, res) => {
    if (!req.session) return res.sendStatus(204);
    req.session.destroy(error => {
      if (error) {
        console.error('Could not destroy authenticated session.');
        return res.status(500).json({ error: 'Could not log out right now. Please try again.' });
      }
      res.clearCookie('studybuddy.sid', {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        path: '/'
      });
      res.sendStatus(204);
    });
  });

  router.get('/me', (req, res) => {
    res.json({ authenticated: req.session?.authenticated === true });
  });

  return router;
}

module.exports = { createAuthRouter };
