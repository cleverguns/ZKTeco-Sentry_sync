'use strict';

function requireApiKey(req, res, next) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'API_KEY not configured in .env' });
  }
  const header = req.headers['authorization'] || '';
  const match  = header.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1].trim() !== apiKey) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Use: Authorization: Bearer <your-api-key>' });
  }
  next();
}

module.exports = { requireApiKey };
