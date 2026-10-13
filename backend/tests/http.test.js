'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-'.padEnd(48, 'x');

const AppError = require('../src/utils/AppError');
const { errorHandler, notFound } = require('../src/middleware/errorHandler');
const { authorize } = require('../src/middleware/auth');
const rateLimit = require('../src/middleware/rateLimit');
const sanitizeQuery = require('../src/middleware/sanitizeQuery');

const hasPackage = (name) => {
  try {
    require.resolve(name);
    return true;
  } catch (err) {
    return false;
  }
};

function fakeRes() {
  const res = { headers: {}, statusCode: 200, body: null, headersSent: false };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  res.setHeader = (k, v) => {
    res.headers[k] = v;
  };
  return res;
}

const handle = (err) => {
  const res = fakeRes();
  errorHandler(err, { method: 'GET', originalUrl: '/x' }, res, () => {});
  return res;
};

test('errorHandler maps known error types to HTTP statuses', () => {
  assert.equal(handle(AppError.notFound('nope')).statusCode, 404);
  assert.equal(handle(AppError.conflict('dup')).body.message, 'dup');

  const validation = Object.assign(new Error('v'), { name: 'ValidationError', errors: { name: { path: 'name', message: 'required' } } });
  const v = handle(validation);
  assert.equal(v.statusCode, 400);
  assert.deepEqual(v.body.details, [{ field: 'name', message: 'required' }]);

  assert.equal(handle(Object.assign(new Error('c'), { name: 'CastError', path: '_id', value: 'x' })).statusCode, 400);
  const dup = handle(Object.assign(new Error('E11000'), { code: 11000, keyValue: { email: 'a@b.c' } }));
  assert.equal(dup.statusCode, 409);
  assert.match(dup.body.message, /email/);
  assert.equal(handle(Object.assign(new Error('bad json'), { type: 'entity.parse.failed' })).statusCode, 400);
  assert.equal(handle(Object.assign(new Error('jwt'), { name: 'JsonWebTokenError' })).statusCode, 401);
});

test('errorHandler never leaks internals for unexpected errors in production', () => {
  const config = require('../src/config/env');
  const previous = config.isProduction;
  config.isProduction = true;
  try {
    const res = handle(new Error('database password is hunter2'));
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, 'Internal server error');
    assert.equal(res.body.stack, undefined);
  } finally {
    config.isProduction = previous;
  }
});

test('notFound produces a 404 AppError', () => {
  let received;
  notFound({ method: 'GET', originalUrl: '/api/none' }, {}, (err) => {
    received = err;
  });
  assert.equal(received.statusCode, 404);
});

test('authorize allows listed roles only', () => {
  const guard = authorize('ADMIN', 'OPERATOR');
  let err;
  guard({ user: { role: 'OPERATOR' } }, {}, (e) => {
    err = e;
  });
  assert.equal(err, undefined);
  guard({ user: { role: 'WAREHOUSE' } }, {}, (e) => {
    err = e;
  });
  assert.equal(err.statusCode, 403);
  guard({}, {}, (e) => {
    err = e;
  });
  assert.equal(err.statusCode, 401);
});

test('sanitizeQuery drops objects/operators and keeps the last repeated value', () => {
  const req = { query: { status: ['A', 'B'], batchId: { $ne: 'x' }, page: '2', 'weird[$gt]': '' } };
  sanitizeQuery(req, {}, () => {});
  assert.deepEqual(req.query, { status: 'B', page: '2', 'weird[$gt]': '' });
});

test('rateLimit blocks after the configured number of requests', () => {
  const limiter = rateLimit({ windowMs: 60000, max: 2 });
  const results = [];
  for (let i = 0; i < 3; i += 1) limiter({ ip: '1.2.3.4' }, fakeRes(), (e) => results.push(e));
  assert.equal(results[0], undefined);
  assert.equal(results[1], undefined);
  assert.equal(results[2].statusCode, 429);
});

test('HTTP layer: health, 404, auth guard and validation (no database needed)', { skip: !hasPackage('express') }, async () => {
  const http = require('http');
  const app = require('../src/app');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, options = {}) => {
    const res = await fetch(base + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    return { status: res.status, body: await res.json() };
  };

  try {
    const health = await call('/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');

    const missing = await call('/api/does-not-exist');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.success, false);

    for (const path of ['/api/vaccines', '/api/batches', '/api/shipments', '/api/inventory', '/api/alerts', '/api/dashboard', '/api/simulation']) {
      const res = await call(path);
      assert.equal(res.status, 401, path);
    }
    assert.equal((await call('/api/shipments', { headers: { Authorization: 'Bearer not-a-jwt' } })).status, 401);

    const badLogin = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'nope' }) });
    assert.equal(badLogin.status, 400);
    assert.ok(Array.isArray(badLogin.body.details));

    const badJson = await call('/api/auth/login', { method: 'POST', body: '{oops' });
    assert.equal(badJson.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('PDF report renders a valid PDF', { skip: !hasPackage('pdfkit') }, async () => {
  const { renderPdfBuffer } = require('../src/services/reportService');
  const { makeShipment } = require('./helpers');
  const shipment = {
    ...makeShipment({ status: 'DELIVERED', currentTemperature: 5.1, currentLatitude: 14, currentLongitude: 81 }),
    startTime: new Date('2026-01-01T08:00:00Z'),
    expectedDelivery: new Date('2026-01-01T12:00:00Z'),
    actualDelivery: new Date('2026-01-01T11:30:00Z'),
    createdBy: { name: 'Asha', email: 'asha@example.com' },
  };
  const t0 = Date.parse('2026-01-01T08:00:00Z');
  const data = {
    generatedAt: new Date(),
    shipment,
    batch: { batchNumber: 'CVS-1', manufacturingDate: new Date(t0 - 86400000 * 30), expiryDate: new Date(t0 + 86400000 * 300) },
    vaccine: { name: 'Covishield', manufacturer: 'SII', type: 'Viral vector', storageMin: 2, storageMax: 8 },
    routeKm: 129.4,
    summary: { total: 50, normal: 47, excursions: 3, min: 3.1, max: 9.2, average: 5.4 },
    events: [{ start: new Date(t0), end: new Date(t0 + 600000), readings: 3, direction: 'HIGH', peakTemperature: 9.2, peakDeviation: 1.2, durationMinutes: 10 }],
    alerts: Array.from({ length: 80 }, (_, i) => ({ timestamp: new Date(t0 + i * 1000), type: 'TEMPERATURE_EXCURSION', severity: 'CRITICAL', resolved: i % 2 === 0, message: `Alert ${i} with a fairly long message text that will be truncated in the table cell` })),
    compliance: { score: 94, totalReadings: 50, normalReadings: 47, excursionCount: 1, delayCount: 0, routeDeviationCount: 0, sensorFailureCount: 0 },
  };
  const buffer = await renderPdfBuffer(data);
  assert.ok(buffer.length > 1000);
  assert.equal(buffer.slice(0, 5).toString(), '%PDF-');
});
