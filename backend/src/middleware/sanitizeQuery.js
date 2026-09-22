'use strict';

/**
 * Keeps only plain string query parameters (last value wins for repeated keys).
 * Together with the "simple" query parser this makes NoSQL operator injection through
 * URLs such as ?batchId[$ne]=x impossible: services only ever see strings.
 */
module.exports = function sanitizeQuery(req, res, next) {
  const clean = {};
  for (const [key, value] of Object.entries(req.query || {})) {
    const single = Array.isArray(value) ? value[value.length - 1] : value;
    if (typeof single === 'string') clean[key] = single;
  }
  req.query = clean;
  next();
};
