'use strict';
const router = require('express').Router();
const db     = require('../db');

/**
 * POST /api/sync/personnel
 *
 * Batch upsert: accepts an array of employee records from an external HRIS
 * and syncs them into Sentry. Each record is checked first:
 *   - already exists  → skipped (no duplicate created)
 *   - does not exist  → created (Personnels + GroupMembers + ZkUsers)
 *   - missing fields  → reported as failed
 *
 * Request body:
 * {
 *   "employees": [
 *     {
 *       "personnel_no": "12345",      // required — must match your HRIS employee ID
 *       "first_name":   "Juan",       // required
 *       "last_name":    "Dela Cruz",  // required
 *       "middle_name":  "Santos",     // optional
 *       "contact":      "09171234567",// optional
 *       "group_id":     "<sentry-group-guid>" // optional — get from GET /api/groups
 *     }
 *   ]
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "summary": { "total": 3, "created": 2, "skipped": 1, "failed": 0 },
 *   "results": [
 *     { "personnel_no": "12345", "status": "created", "id": "<new-guid>" },
 *     { "personnel_no": "99999", "status": "skipped", "message": "Already exists in Sentry." },
 *     { "personnel_no": null,    "status": "failed",  "message": "Missing personnel_no" }
 *   ]
 * }
 */
router.post('/sync/personnel', async (req, res) => {
  const employees = req.body.employees;

  if (!Array.isArray(employees) || employees.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Body must contain a non-empty "employees" array.',
    });
  }

  const results = [];
  let created = 0, skipped = 0, failed = 0;

  for (const emp of employees) {
    const pno = String(emp.personnel_no || '').trim();

    if (!pno) {
      results.push({ personnel_no: null, status: 'failed', message: 'Missing personnel_no' });
      failed++;
      continue;
    }

    try {
      if (await db.personnelExists(pno)) {
        results.push({ personnel_no: pno, status: 'skipped', message: 'Already exists in Sentry.' });
        skipped++;
      } else {
        const outcome = await db.createPersonnel(emp);
        if (outcome.success) {
          results.push({ personnel_no: pno, status: 'created', id: outcome.id });
          created++;
        } else {
          results.push({ personnel_no: pno, status: 'failed', message: outcome.message });
          failed++;
        }
      }
    } catch (err) {
      results.push({ personnel_no: pno, status: 'failed', message: err.message });
      failed++;
    }
  }

  res.json({
    success: true,
    summary: { total: employees.length, created, skipped, failed },
    results,
  });
});

/**
 * POST /api/sync/attendance
 *
 * Pull attendance for multiple employees over a date range in a single request.
 * Useful when your HRIS needs to batch-sync timekeeping data.
 *
 * Request body:
 * {
 *   "personnel_nos": ["12345", "67890"],
 *   "start_date": "2026-05-01",
 *   "end_date":   "2026-05-31"
 * }
 */
router.post('/sync/attendance', async (req, res) => {
  const { personnel_nos, start_date, end_date } = req.body;

  if (!Array.isArray(personnel_nos) || personnel_nos.length === 0) {
    return res.status(400).json({ success: false, message: 'Body must contain a non-empty "personnel_nos" array.' });
  }
  if (!start_date || !end_date) {
    return res.status(400).json({ success: false, message: 'Required fields: start_date (YYYY-MM-DD), end_date (YYYY-MM-DD)' });
  }

  const results = [];
  let fetchFailed = 0;

  for (const pno of personnel_nos) {
    const personnelNo = String(pno || '').trim();
    if (!personnelNo) { fetchFailed++; continue; }
    try {
      const logs = await db.getAttendance(personnelNo, start_date.trim(), end_date.trim());
      results.push({ personnel_no: personnelNo, log_count: logs.length, logs });
    } catch (err) {
      results.push({ personnel_no: personnelNo, log_count: 0, error: err.message });
      fetchFailed++;
    }
  }

  res.json({
    success: true,
    summary: {
      total: personnel_nos.length,
      fetched: personnel_nos.length - fetchFailed,
      failed: fetchFailed,
    },
    results,
  });
});

module.exports = router;
