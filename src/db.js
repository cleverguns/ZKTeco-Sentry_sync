'use strict';

'use strict';

// msnodesqlv8 wraps the native Windows ODBC driver — same as PHP's PDO ODBC.
// Windows Authentication (Trusted_Connection) works out of the box.
// Requires Node.js 22 LTS (has pre-built binary, no build tools needed).
const sql = require('mssql/msnodesqlv8');

const GROUP_TYPE_SITE = 'F54DEE41-29CC-4E96-A4A3-E5C327A388E2';

let _pool = null;

const ODBC_DRIVERS = [
  'ODBC Driver 17 for SQL Server',
  'ODBC Driver 13 for SQL Server',
  'SQL Server Native Client 11.0',
  'SQL Server',
];

function buildConnStr(driver) {
  const server   = process.env.SENTRY_DB_SERVER;
  const database = process.env.SENTRY_DB_NAME;
  let s = `Driver={${driver}};Server=${server};Database=${database};TrustServerCertificate=yes;`;
  if (process.env.SENTRY_DB_USER) {
    s += `UID=${process.env.SENTRY_DB_USER};PWD=${process.env.SENTRY_DB_PASS || ''};`;
  } else {
    s += 'Trusted_Connection=yes;';
  }
  return s;
}

async function getPool() {
  if (_pool) return _pool;

  const server   = process.env.SENTRY_DB_SERVER;
  const database = process.env.SENTRY_DB_NAME;
  if (!server || !database) {
    throw new Error('SENTRY_DB_SERVER or SENTRY_DB_NAME not set in .env');
  }

  let lastErr;
  for (const driver of ODBC_DRIVERS) {
    try {
      _pool = await sql.connect({ connectionString: buildConnStr(driver) });
      return _pool;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function generateGuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

async function getGroups() {
  const pool   = await getPool();
  const result = await pool.request().query(
    'SELECT Id, Name, GroupTypeId FROM Groups WHERE IsDeleted = 0 ORDER BY Name'
  );
  return result.recordset;
}

// ---------------------------------------------------------------------------
// Personnel
// ---------------------------------------------------------------------------

async function getPersonnel(includeDeleted = false) {
  const pool = await getPool();
  let query  = 'SELECT Id, PersonnelNo, FirstName, LastName, MiddleName, ContactNumber, AccessNumber, DateCreated FROM Personnels';
  if (!includeDeleted) query += ' WHERE IsDeleted = 0';
  query += ' ORDER BY LastName, FirstName';
  const result = await pool.request().query(query);
  return result.recordset;
}

async function findPersonnel(personnelNo) {
  const pool   = await getPool();
  const result = await pool.request()
    .input('pno', sql.NVarChar, personnelNo)
    .query('SELECT Id, PersonnelNo, FirstName, LastName, MiddleName, ContactNumber, AccessNumber FROM Personnels WHERE PersonnelNo = @pno AND IsDeleted = 0');
  return result.recordset[0] || null;
}

async function personnelExists(personnelNo) {
  return (await findPersonnel(personnelNo)) !== null;
}

async function createPersonnel(data) {
  for (const field of ['personnel_no', 'first_name', 'last_name']) {
    if (!data[field] || !String(data[field]).trim()) {
      return { success: false, message: `Missing required field: ${field}` };
    }
  }

  const personnelId = generateGuid();
  const pno   = String(data.personnel_no).trim();
  const fname = String(data.first_name).trim().toUpperCase();
  const lname = String(data.last_name).trim().toUpperCase();
  const mname = data.middle_name && String(data.middle_name).trim()
    ? String(data.middle_name).trim().toUpperCase()
    : null;
  const phone = data.contact && String(data.contact).trim()
    ? String(data.contact).trim()
    : null;
  const gid   = data.group_id && String(data.group_id).trim()
    ? String(data.group_id).trim()
    : null;

  const pool = await getPool();
  const tx   = new sql.Transaction(pool);
  await tx.begin();

  try {
    // 1. INSERT Personnels — AccessNumber = PersonnelNo (Sentry links TimeLogs via this)
    await new sql.Request(tx)
      .input('id',    sql.NVarChar, personnelId)
      .input('pno',   sql.NVarChar, pno)
      .input('lname', sql.NVarChar, lname)
      .input('fname', sql.NVarChar, fname)
      .input('mname', sql.NVarChar, mname)
      .input('phone', sql.NVarChar, phone)
      .query(`INSERT INTO Personnels (Id, DateCreated, IsDeleted, PersonnelNo, AccessNumber, LastName, FirstName, MiddleName, ContactNumber)
              VALUES (@id, SYSDATETIMEOFFSET(), 0, @pno, @pno, @lname, @fname, @mname, @phone)`);

    // 2. INSERT GroupMembers (optional — skip if no group supplied)
    if (gid) {
      await new sql.Request(tx)
        .input('id',          sql.NVarChar, generateGuid())
        .input('groupTypeId', sql.NVarChar, GROUP_TYPE_SITE)
        .input('groupId',     sql.NVarChar, gid)
        .input('personnelId', sql.NVarChar, personnelId)
        .query(`INSERT INTO GroupMembers (Id, DateCreated, IsDeleted, GroupTypeId, GroupId, PersonnelId)
                VALUES (@id, SYSDATETIMEOFFSET(), 0, @groupTypeId, @groupId, @personnelId)`);
    }

    // 3. INSERT ZkUsers — device-level record required for biometric enrollment
    await new sql.Request(tx)
      .input('pno',         sql.NVarChar, pno)
      .input('name',        sql.NVarChar, `${fname} ${lname}`)
      .input('personnelId', sql.NVarChar, personnelId)
      .query(`INSERT INTO ZkUsers (Id, DateCreated, IsDeleted, AccessNumber, Privilege, FpCount, FaceCount, PalmCount, Name, PersonnelId)
              VALUES (NEWID(), SYSDATETIMEOFFSET(), 0, @pno, 'USER', 0, 0, 0, @name, @personnelId)`);

    await tx.commit();
    return { success: true, message: 'Personnel created successfully.', id: personnelId };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function updatePersonnel(personnelNo, data) {
  const existing = await findPersonnel(personnelNo);
  if (!existing) return { success: false, message: 'Personnel not found.' };

  const sets   = [];
  const inputs = [{ name: 'pno', type: sql.NVarChar, value: personnelNo }];

  if (data.first_name !== undefined) {
    sets.push('FirstName = @fname');
    inputs.push({ name: 'fname', type: sql.NVarChar, value: String(data.first_name).trim().toUpperCase() });
  }
  if (data.last_name !== undefined) {
    sets.push('LastName = @lname');
    inputs.push({ name: 'lname', type: sql.NVarChar, value: String(data.last_name).trim().toUpperCase() });
  }
  if ('middle_name' in data) {
    sets.push('MiddleName = @mname');
    inputs.push({ name: 'mname', type: sql.NVarChar, value: data.middle_name && String(data.middle_name).trim() ? String(data.middle_name).trim().toUpperCase() : null });
  }
  if ('contact' in data) {
    sets.push('ContactNumber = @phone');
    inputs.push({ name: 'phone', type: sql.NVarChar, value: data.contact && String(data.contact).trim() ? String(data.contact).trim() : null });
  }

  if (!sets.length) return { success: false, message: 'No updatable fields provided.' };

  const pool = await getPool();
  const req  = pool.request();
  for (const { name, type, value } of inputs) req.input(name, type, value);
  await req.query(`UPDATE Personnels SET ${sets.join(', ')} WHERE PersonnelNo = @pno AND IsDeleted = 0`);
  return { success: true, message: 'Personnel updated successfully.' };
}

async function deletePersonnel(personnelNo) {
  if (!(await personnelExists(personnelNo))) return { success: false, message: 'Personnel not found.' };
  const pool = await getPool();
  await pool.request()
    .input('pno', sql.NVarChar, personnelNo)
    .query('UPDATE Personnels SET IsDeleted = 1 WHERE PersonnelNo = @pno');
  return { success: true, message: 'Personnel soft-deleted.' };
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

async function getAttendance(personnelNo, startDate, endDate) {
  const pool   = await getPool();
  const result = await pool.request()
    .input('pno',   sql.NVarChar, personnelNo)
    .input('start', sql.Date,     startDate)
    .input('end',   sql.Date,     endDate)
    .query(`SELECT tl.RecordDate, tl.TimeLogStamp, tl.LogType, tl.Location, tl.DeviceSerialNumber
            FROM TimeLogs tl
            JOIN Personnels p ON tl.AccessNumber = p.AccessNumber
            WHERE p.PersonnelNo = @pno
              AND tl.RecordDate BETWEEN @start AND @end
              AND tl.IsDeleted = 0
            ORDER BY tl.TimeLogStamp`);
  return result.recordset;
}

module.exports = {
  getPool,
  getGroups,
  getPersonnel,
  findPersonnel,
  personnelExists,
  createPersonnel,
  updatePersonnel,
  deletePersonnel,
  getAttendance,
};
