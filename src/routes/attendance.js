'use strict';
const router = require('express').Router();
const db     = require('../db');

router.get('/attendance', async (req, res) => {
  const { personnel_no, start_date, end_date } = req.query;
  if (!personnel_no || !start_date || !end_date) {
    return res.status(400).json({
      success: false,
      message: 'Required params: personnel_no, start_date (YYYY-MM-DD), end_date (YYYY-MM-DD)',
    });
  }
  try {
    const logs = await db.getAttendance(
      personnel_no.trim(),
      start_date.trim(),
      end_date.trim()
    );
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
