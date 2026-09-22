'use strict';

const AppError = require('../utils/AppError');

/**
 * Minimal in-memory fixed-window rate limiter (per client IP). Meant for the auth endpoints;
 * for multi-instance deployments use a shared store or a reverse proxy instead.
 */
function rateLimit({ windowMs = 15 * 60 * 1000, max = 50, message = 'Too many requests, please try again later' } = {}) {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs);
  if (sweep.unref) sweep.unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return next(new AppError(message, 429));
    }
    return next();
  };
}

module.exports = rateLimit;
