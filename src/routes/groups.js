'use strict';
const router = require('express').Router();
const db     = require('../db');

router.get('/groups', async (req, res) => {
  try {
    res.json({ success: true, data: await db.getGroups() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
