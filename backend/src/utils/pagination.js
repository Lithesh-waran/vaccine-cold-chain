'use strict';

function parsePagination(query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;
  return { page, limit, skip: (page - 1) * limit };
}

function buildMeta(page, limit, total) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/**
 * Turns "?sort=-createdAt,name" into a Mongo sort object, restricted to whitelisted fields.
 */
function parseSort(sort, allowed, fallback = { createdAt: -1 }) {
  if (!sort || typeof sort !== 'string') return fallback;
  const result = {};
  for (const part of sort.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const desc = trimmed.startsWith('-');
    const field = desc ? trimmed.slice(1) : trimmed;
    if (allowed.includes(field)) result[field] = desc ? -1 : 1;
  }
  return Object.keys(result).length ? result : fallback;
}

module.exports = { parsePagination, buildMeta, parseSort };
