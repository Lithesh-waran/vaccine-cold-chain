'use strict';

const config = require('./env');

/**
 * Shared CORS policy for the REST API and Socket.IO.
 * Requests without an Origin header (curl, Postman, server-to-server) are always allowed.
 */
function isOriginAllowed(origin) {
  if (!origin) return true;
  return config.corsOrigins.includes('*') || config.corsOrigins.includes(origin);
}

const corsOptions = {
  origin(origin, callback) {
    callback(null, isOriginAllowed(origin));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 600,
};

module.exports = { corsOptions, isOriginAllowed };
