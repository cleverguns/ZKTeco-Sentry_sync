'use strict';
require('dotenv').config();

const express = require('express');
const path    = require('path');
const app     = express();

// Serve the demo web app — no auth required for static files
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  });
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const { requireApiKey } = require('./src/auth');
app.use('/api', requireApiKey);

app.use('/api', require('./src/routes/health'));
app.use('/api', require('./src/routes/groups'));
app.use('/api', require('./src/routes/personnel'));
app.use('/api', require('./src/routes/attendance'));
app.use('/api', require('./src/routes/sync'));

app.use((req, res) => res.status(404).json({ success: false, message: 'Endpoint not found.' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sentry API running on port ${PORT}`));
