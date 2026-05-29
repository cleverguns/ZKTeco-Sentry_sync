'use strict';
const router = require('express').Router();
const db     = require('../db');

router.get('/personnel', async (req, res) => {
  try {
    const includeDeleted = req.query.include_deleted === '1';
    res.json({ success: true, data: await db.getPersonnel(includeDeleted) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/personnel/:personnelNo', async (req, res) => {
  try {
    const record = await db.findPersonnel(req.params.personnelNo);
    if (record) {
      res.json({ success: true, exists: true, data: record });
    } else {
      res.json({ success: true, exists: false });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/personnel', async (req, res) => {
  try {
    const pno = String(req.body.personnel_no || '').trim();
    if (pno && await db.personnelExists(pno)) {
      return res.json({ success: true, message: 'Personnel already exists in Sentry.', already_exists: true });
    }
    const result = await db.createPersonnel(req.body);
    res.status(result.success ? 201 : 400).json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/personnel/:personnelNo', async (req, res) => {
  try {
    const result = await db.updatePersonnel(req.params.personnelNo, req.body);
    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/personnel/:personnelNo', async (req, res) => {
  try {
    const result = await db.deletePersonnel(req.params.personnelNo);
    res.status(result.success ? 200 : 404).json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
