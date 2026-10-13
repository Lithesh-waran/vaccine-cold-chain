'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');

const { v, validate, objectIdParam, refParam } = require('../src/middleware/validate');
const schemas = require('../src/middleware/schemas');

const run = (mw, req) =>
  new Promise((resolve) => {
    mw(req, {}, (err) => resolve({ err, req }));
  });

test('validate coerces values, trims strings and drops unknown fields', async () => {
  const mw = validate({ name: v.string({ required: true, min: 2 }), qty: v.integer({ required: true, min: 1 }) });
  const { err, req } = await run(mw, { body: { name: '  Ann ', qty: '5', isAdmin: true } });
  assert.equal(err, undefined);
  assert.deepEqual(req.body, { name: 'Ann', qty: 5 });
});

test('validate reports every problem with its field path', async () => {
  const mw = validate({
    name: v.string({ required: true, min: 2 }),
    source: v.object({ latitude: v.number({ required: true, min: -90, max: 90 }) }, { required: true }),
  });
  const { err } = await run(mw, { body: { name: 'a', source: { latitude: 200 } } });
  assert.equal(err.statusCode, 400);
  const fields = err.details.map((d) => d.field).sort();
  assert.deepEqual(fields, ['name', 'source.latitude']);
});

test('partial validation skips required fields but rejects empty updates', async () => {
  const mw = validate({ name: v.string({ required: true }) }, { partial: true });
  assert.equal((await run(mw, { body: { name: 'x' } })).err, undefined);
  assert.equal((await run(mw, { body: {} })).err.statusCode, 400);
});

test('register schema requires a valid e-mail and a password of at least 8 characters', async () => {
  const mw = validate(schemas.auth.register);
  assert.equal((await run(mw, { body: { name: 'Ann', email: 'nope', password: 'short' } })).err.details.length, 2);
  const ok = await run(mw, { body: { name: 'Ann', email: 'ANN@Example.com', password: 'longenough1' } });
  assert.equal(ok.err, undefined);
  assert.equal(ok.req.body.email, 'ann@example.com');
});

test('role must be one of the known roles', async () => {
  const mw = validate(schemas.auth.register);
  const { err } = await run(mw, { body: { name: 'Ann', email: 'a@b.co', password: 'longenough1', role: 'root' } });
  assert.equal(err.details[0].field, 'role');
});

test('shipment schema validates coordinates and route', async () => {
  const mw = validate(schemas.shipmentCreate);
  const good = {
    batchId: '65f000000000000000000002',
    quantity: 10,
    source: { name: 'Alpha', latitude: 13, longitude: 80 },
    destination: { name: 'Beta', latitude: 12, longitude: 77, warehouseId: 'wh-b' },
  };
  const ok = await run(mw, { body: good });
  assert.equal(ok.err, undefined);
  assert.equal(ok.req.body.destination.warehouseId, 'WH-B');

  const bad = await run(mw, { body: { ...good, quantity: 0, route: [{ latitude: 1, longitude: 1 }] } });
  assert.equal(bad.err.statusCode, 400);
});

test('id params are validated', async () => {
  assert.equal((await run(objectIdParam(), { params: { id: 'zzz' } })).err.statusCode, 400);
  assert.equal((await run(objectIdParam(), { params: { id: '65f000000000000000000001' } })).err, undefined);
  assert.equal((await run(refParam(), { params: { id: 'SHP-20260101-AB12' } })).err, undefined);
  assert.equal((await run(refParam(), { params: { id: '../etc' } })).err.statusCode, 400);
});
