'use strict';
const router = require('express').Router();
const db     = require('../db');

router.get('/health', async (req, res) => {
  try {
    await db.getPool();
    res.json({ success: true, message: 'Connected to Sentry DB.' });
  } catch (err) {
    res.status(503).json({ success: false, message: 'Cannot connect to Sentry DB: ' + err.message });
  }
});

module.exports = router;
