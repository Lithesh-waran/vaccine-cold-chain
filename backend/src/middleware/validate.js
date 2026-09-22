'use strict';

const AppError = require('../utils/AppError');

/**
 * Small dependency-free request validator.
 *  - unknown fields are dropped (protects against mass assignment),
 *  - values are trimmed / coerced (numbers, booleans, dates) and returned in req.body,
 *  - every problem is reported at once as details: [{ field, message }].
 */
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const v = {
  string: (opts = {}) => ({ kind: 'string', ...opts }),
  email: (opts = {}) => ({ kind: 'email', ...opts }),
  number: (opts = {}) => ({ kind: 'number', ...opts }),
  integer: (opts = {}) => ({ kind: 'number', integer: true, ...opts }),
  boolean: (opts = {}) => ({ kind: 'boolean', ...opts }),
  date: (opts = {}) => ({ kind: 'date', ...opts }),
  oneOf: (values, opts = {}) => ({ kind: 'enum', values, ...opts }),
  objectId: (opts = {}) => ({ kind: 'objectId', ...opts }),
  array: (items, opts = {}) => ({ kind: 'array', items, ...opts }),
  object: (shape, opts = {}) => ({ kind: 'object', shape, ...opts }),
  any: (opts = {}) => ({ kind: 'any', ...opts }),
};

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function check(rule, value, path, errors, isTopLevelPartial) {
  const missing = value === undefined || value === null || value === '';
  if (missing) {
    if (value === null && rule.nullable) return null;
    if (rule.required && !isTopLevelPartial) errors.push({ field: path, message: 'is required' });
    return undefined;
  }
  const fail = (message) => {
    errors.push({ field: path, message });
    return undefined;
  };

  switch (rule.kind) {
    case 'string':
    case 'email': {
      if (typeof value !== 'string') return fail('must be a string');
      let s = rule.trim === false ? value : value.trim();
      if (rule.kind === 'email') {
        s = s.toLowerCase();
        if (!EMAIL.test(s)) return fail('must be a valid e-mail address');
      }
      if (rule.lowercase) s = s.toLowerCase();
      if (rule.uppercase) s = s.toUpperCase();
      if (rule.min !== undefined && s.length < rule.min) return fail(`must be at least ${rule.min} characters`);
      if (rule.max !== undefined && s.length > rule.max) return fail(`must be at most ${rule.max} characters`);
      if (rule.pattern && !rule.pattern.test(s)) return fail(rule.patternMessage || 'has an invalid format');
      return s;
    }
    case 'number': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) return fail('must be a number');
      if (rule.integer && !Number.isInteger(n)) return fail('must be an integer');
      if (rule.min !== undefined && n < rule.min) return fail(`must be >= ${rule.min}`);
      if (rule.max !== undefined && n > rule.max) return fail(`must be <= ${rule.max}`);
      if (rule.gt !== undefined && !(n > rule.gt)) return fail(`must be > ${rule.gt}`);
      return n;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      return fail('must be a boolean');
    }
    case 'date': {
      if (typeof value !== 'string' && typeof value !== 'number') return fail('must be a valid date (ISO 8601)');
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return fail('must be a valid date (ISO 8601)');
      return d;
    }
    case 'enum': {
      const candidate = rule.upper && typeof value === 'string' ? value.trim().toUpperCase() : value;
      if (!rule.values.includes(candidate)) return fail(`must be one of: ${rule.values.join(', ')}`);
      return candidate;
    }
    case 'objectId': {
      if (typeof value !== 'string' || !OBJECT_ID.test(value)) return fail('must be a valid id');
      return value;
    }
    case 'array': {
      if (!Array.isArray(value)) return fail('must be an array');
      if (rule.minItems !== undefined && value.length < rule.minItems) return fail(`must contain at least ${rule.minItems} items`);
      if (rule.maxItems !== undefined && value.length > rule.maxItems) return fail(`must contain at most ${rule.maxItems} items`);
      const out = value.map((item, i) => check({ ...rule.items, required: true }, item, `${path}[${i}]`, errors, false));
      return out;
    }
    case 'object': {
      if (!isPlainObject(value)) return fail('must be an object');
      return validateShape(rule.shape, value, path, errors, false);
    }
    default:
      return value;
  }
}

function validateShape(shape, input, prefix, errors, partial) {
  const out = {};
  for (const [key, rule] of Object.entries(shape)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const cleaned = check(rule, input[key], path, errors, partial);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

/**
 * Express middleware. `partial: true` makes top-level required fields optional (used for PUT/PATCH updates)
 * but still rejects an empty update.
 */
function validate(shape, { partial = false, allowEmpty = false } = {}) {
  return (req, res, next) => {
    const input = req.body === undefined ? {} : req.body;
    if (!isPlainObject(input)) return next(AppError.badRequest('Request body must be a JSON object'));

    const errors = [];
    const cleaned = validateShape(shape, input, '', errors, partial);
    if (errors.length) return next(AppError.badRequest('Validation failed', errors));
    if (partial && !allowEmpty && Object.keys(cleaned).length === 0) {
      return next(AppError.badRequest('Provide at least one field to update'));
    }
    req.body = cleaned;
    return next();
  };
}

/** Validates a :param as a Mongo ObjectId. */
const objectIdParam = (name = 'id') => (req, res, next) => {
  if (!OBJECT_ID.test(String(req.params[name] || ''))) {
    return next(AppError.badRequest(`Invalid ${name}: must be a 24-character hexadecimal id`));
  }
  return next();
};

/** Validates a :param that is either an ObjectId or a human readable code such as SHP-20260101-AB12. */
const refParam = (name = 'id') => (req, res, next) => {
  const value = String(req.params[name] || '');
  if (!OBJECT_ID.test(value) && !/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(value)) {
    return next(AppError.badRequest(`Invalid ${name}`));
  }
  return next();
};

module.exports = { v, validate, objectIdParam, refParam, OBJECT_ID };
