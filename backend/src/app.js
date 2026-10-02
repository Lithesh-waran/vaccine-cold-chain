'use strict';

const express = require('express');
const cors = require('cors');
const { corsOptions } = require('./config/cors');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const sanitizeQuery = require('./middleware/sanitizeQuery');

const path = require('path');
const fs = require('fs');
const config = require('./config/env');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.set('query parser', 'simple'); // no nested objects in query strings (?a[$ne]=b)

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(sanitizeQuery);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.get('/health', (req, res) => res.json({ success: true, status: 'ok', uptime: Math.round(process.uptime()), timestamp: new Date().toISOString() }));

app.use('/api', routes);

// Serve static frontend in production/unified deployment if client/dist exists
const clientDist = path.resolve(__dirname, '../../client/dist');
if (!config.isTest && (process.env.SERVE_STATIC === 'true' || config.isProduction) && fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use(notFound);
app.use(errorHandler);

module.exports = app;
