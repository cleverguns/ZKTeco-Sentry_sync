# ZKTeco Sentry Direct API

A Node.js REST API that talks directly to the ZKTeco Sentry MSSQL database — bypassing the limitations of Sentry's official API which only supports pulling attendance logs and has no endpoint for creating or syncing personnel.

---

## Why This Exists

ZKTeco Sentry stores everything in a local Microsoft SQL Server (MSSQL) database on the same Windows machine as the Sentry application. The official Sentry API does not expose personnel management at all.

This project wraps that database into a clean REST API so any application can:

- Create employees in Sentry the moment they are onboarded in your HRIS — no CSV, no manual import
- Keep employee IDs perfectly in sync (Sentry links attendance logs to `PersonnelNo` — if this doesn't match your HRIS, attendance queries silently return nothing)
- Pull attendance logs without dealing with Sentry's token-based API
- Batch-sync multiple employees at once

---

## Architecture

![System Architecture](public/sync-diagram.png)

---

## Critical Requirements

Read this section carefully. Missing any of these will cause connection failures.

### 1. Node.js 22 LTS — not 23, 24, or 25

This project uses `msnodesqlv8`, a native Windows module that connects to SQL Server via the Windows ODBC driver. It ships with pre-built binaries **only for Node.js LTS versions (18, 20, 22)**. If you install a newer non-LTS version (e.g. v25), `npm install` will fail because it will try to compile the native module and fail without Visual C++ Build Tools.

**Download:** https://nodejs.org — click the **LTS** button (currently 22.x.x).

Verify after install:
```powershell
node --version   # must be v22.x.x
```

### 2. Must run on the same machine as Sentry

This is the most important requirement. The SQL Server instance (`DESKTOP-YOURSERVER\SQLEXPRESS`) uses **Windows Authentication only** — no username or password. Windows Authentication works by passing the credentials of the current Windows user to SQL Server. This only works reliably when the Node.js process runs **on the same machine** as SQL Server.

If you run Node.js on a different machine, Windows Auth will fail with `Login failed for user ''` even if the ODBC driver and connection string are correct.

```
✅  Node.js + SQL Server on DESKTOP-UVFNQD4  →  Works
❌  Node.js on another machine → SQL Server on DESKTOP-UVFNQD4  →  Fails
```

### 3. ODBC Driver for SQL Server

One of the following must be installed on the machine:

- ODBC Driver 17 for SQL Server ← recommended
- ODBC Driver 13 for SQL Server
- SQL Server Native Client 11.0
- SQL Server

Check what is installed:
```powershell
powershell -Command "Get-OdbcDriver | Select-Object Name | Sort-Object Name"
```

If none of the SQL Server drivers appear, download **ODBC Driver 17 for SQL Server** from Microsoft.

---

## Installation

**Step 1 — Clone or copy the project to the Sentry machine**

```
C:\Users\user\Desktop\zkteco-sentry-api\   ← example location
```

**Step 2 — Install dependencies**

Open Command Prompt or PowerShell in the project folder:

```powershell
npm install
```

This installs Express, mssql, msnodesqlv8, and dotenv. `msnodesqlv8` will use its pre-built binary for Node.js 22 — no build tools needed.

**Step 3 — Create your `.env` file**

```powershell
copy .env.example .env
```

Edit `.env` with the correct values:

```env
# Your SQL Server instance name
# Check SQL Server Configuration Manager for the exact name
SENTRY_DB_SERVER=DESKTOP-UVFNQD4\SQLEXPRESS
SENTRY_DB_NAME=SentryLocal

# Leave BLANK to use Windows Authentication (required for this setup)
# SQL Server Authentication is disabled on this instance
SENTRY_DB_USER=
SENTRY_DB_PASS=

# Your API key — any string you choose — keep it secret
API_KEY=your-secret-key-here

# Port (default: 3000)
PORT=3000
```

**Step 4 — Start the server**

```powershell
npm start
```

You should see:
```
Sentry API running on port 3000
```

**Step 5 — Open the web app**

Open a browser on the same machine and go to:

```
http://localhost:3000
```

Enter your API key in the top bar and click **Check Connection**. You should get:

```json
{ "success": true, "message": "Connected to Sentry DB." }
```

![Web App Sample Response](public/WebApp-sample-response.PNG)

---

## Troubleshooting

### `Login failed for user ''`

This means Windows Authentication failed. Check the following in order:

1. **Is Node.js running on the same machine as SQL Server?** If not, move the project to the Sentry machine. There is no workaround for cross-machine Windows Auth in a workgroup environment.

2. **Is `SENTRY_DB_USER` blank in `.env`?** If it has any value, the API will try SQL Server Authentication instead. Since this instance only has Windows Auth, it will fail. Make sure `SENTRY_DB_USER=` is empty.

3. **Does your Windows user have SQL Server access?** Test with:
   ```powershell
   sqlcmd -S DESKTOP-UVFNQD4\SQLEXPRESS -d SentryLocal -E -Q "SELECT SYSTEM_USER"
   ```
   If this shows your username, access is fine. If it errors, your Windows user needs to be added to SQL Server by an administrator.

4. **Is `msnodesqlv8` installed?** Run:
   ```powershell
   npm list msnodesqlv8
   ```
   If it shows `(empty)`, run `npm install` again.

---

### `Cannot find module 'msnodesqlv8'`

Run `npm install` — the package was not installed.

---

### `npm install` fails with `gyp ERR! find VS` or build errors

You are on the wrong Node.js version. Install Node.js **22 LTS** from nodejs.org. Uninstall the current version first (Control Panel → Programs → Node.js → Uninstall), then install 22 LTS.

---

### `API_KEY not configured in .env`

The `.env` file does not exist or `API_KEY` is missing. Make sure you ran `copy .env.example .env` and that `API_KEY=` has a value.

---

### `SENTRY_DB_SERVER or SENTRY_DB_NAME not set in .env`

The `.env` file exists but one of these values is blank. Fill them in.

---

## Authentication

Every API request requires the API key you set in `.env`, passed as a Bearer token:

```
Authorization: Bearer your-secret-key-here
```

Requests without this header return `401 Unauthorized`.

In the web app, paste the key into the **API Key** field at the top — just the key value, not `API_KEY=your-key`.

---

## Endpoints

### `GET /api/health`

Tests the database connection.

```json
{ "success": true, "message": "Connected to Sentry DB." }
```

---

### `GET /api/groups`

Lists all site groups in Sentry. Group IDs are needed when creating personnel.

```json
{
  "success": true,
  "data": [
    { "Id": "2F6A6F11-...", "Name": "OREAN PLACE" },
    { "Id": "41A08483-...", "Name": "Cornell Park" }
  ]
}
```

---

### `GET /api/personnel`

Lists all active personnel.

| Query param | Description |
|-------------|-------------|
| `include_deleted=1` | Include soft-deleted records |

---

### `GET /api/personnel/:personnelNo`

Checks if a personnel record exists.

```json
{ "success": true, "exists": true, "data": { ... } }
{ "success": true, "exists": false }
```

---

### `POST /api/personnel`

Creates a new personnel record. Inserts into `Personnels`, `GroupMembers`, and `ZkUsers` in a single transaction.

```json
{
  "personnel_no": "12345",
  "first_name": "Juan",
  "last_name": "Dela Cruz",
  "middle_name": "Santos",
  "contact": "09171234567",
  "group_id": "2F6A6F11-..."
}
```

| Field | Required |
|-------|----------|
| `personnel_no` | ✓ — must match the employee ID in your HRIS |
| `first_name` | ✓ |
| `last_name` | ✓ |
| `middle_name` | optional |
| `contact` | optional |
| `group_id` | optional — GUID from `GET /api/groups` |

If `personnel_no` already exists, returns `already_exists: true` — no duplicate is created.

---

### `PUT /api/personnel/:personnelNo`

Updates an existing personnel record. Send only the fields to update.

---

### `DELETE /api/personnel/:personnelNo`

Soft-deletes a record (`IsDeleted = 1`). The record is not permanently removed.

---

### `GET /api/attendance`

Pulls attendance logs for one employee.

| Query param | Required | Format |
|-------------|----------|--------|
| `personnel_no` | ✓ | |
| `start_date` | ✓ | `YYYY-MM-DD` |
| `end_date` | ✓ | `YYYY-MM-DD` |

```json
{
  "success": true,
  "data": [
    {
      "RecordDate": "2026-05-28",
      "TimeLogStamp": "2026-05-28T07:02:15+08:00",
      "LogType": "IN",
      "Location": "MAIN GATE",
      "DeviceSerialNumber": "ABC123"
    }
  ]
}
```

---

### `POST /api/sync/personnel`

Batch sync — accepts an array of employees and creates each one in Sentry. Existing records are skipped automatically.

```json
{
  "employees": [
    {
      "personnel_no": "12345",
      "first_name": "Juan",
      "last_name": "Dela Cruz",
      "middle_name": "Santos",
      "contact": "09171234567",
      "group_id": "2F6A6F11-..."
    }
  ]
}
```

Response:
```json
{
  "success": true,
  "summary": { "total": 2, "created": 1, "skipped": 1, "failed": 0 },
  "results": [
    { "personnel_no": "12345", "status": "created", "id": "..." },
    { "personnel_no": "67890", "status": "skipped", "message": "Already exists in Sentry." }
  ]
}
```

---

### `POST /api/sync/attendance`

Batch attendance pull — pulls logs for multiple employees in one request.

```json
{
  "personnel_nos": ["12345", "67890"],
  "start_date": "2026-05-01",
  "end_date": "2026-05-31"
}
```

---

## Typical Integration Flow

```
1. Employee onboarded in your HRIS
         ↓
2. GET /api/groups  →  get the group ID for their site
         ↓
3. POST /api/personnel  →  employee appears in Sentry immediately
         ↓
4. Employee enrolls fingerprint/face at biometric device
         ↓
5. Employee punches in/out
         ↓
6. GET /api/attendance  →  pull logs into your HRIS
```

For onboarding multiple employees at once, use `POST /api/sync/personnel` instead of step 3.

---

## Sentry Database Tables

| Table | Purpose |
|-------|---------|
| `Personnels` | Core employee record — `PersonnelNo` must match your HRIS employee ID |
| `GroupMembers` | Assigns an employee to a site group (required for device access) |
| `ZkUsers` | Device-level record — required for biometric enrollment |
| `TimeLogs` | Attendance punch records — linked via `AccessNumber` |

`AccessNumber` is the key field. This API always sets `AccessNumber = PersonnelNo`. If these ever get out of sync, attendance queries will silently return no data.

---

## Keep the Server Running

To keep the API running after you close the terminal, use PM2:

```powershell
npm install -g pm2
pm2 start server.js --name sentry-api
pm2 save
pm2 startup
```

Follow the instructions printed by `pm2 startup` to make it survive reboots.

---

## License

MIT
