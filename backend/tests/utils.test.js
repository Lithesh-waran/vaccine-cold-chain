'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers');

const geo = require('../src/utils/geo');
const { computeScore } = require('../src/utils/compliance');
const { summarizeReadings, findExcursionEvents, downsample } = require('../src/utils/temperatureStats');
const { parsePagination, buildMeta, parseSort } = require('../src/utils/pagination');
const escapeRegex = require('../src/utils/escapeRegex');
const { createRng } = require('../src/utils/random');
const AppError = require('../src/utils/AppError');

test('haversine distance Chennai -> Bengaluru is about 290 km', () => {
  const km = geo.haversineKm({ latitude: 13.0827, longitude: 80.2707 }, { latitude: 12.9716, longitude: 77.5946 });
  assert.ok(km > 280 && km < 300, `got ${km}`);
});

test('generateRoute starts and ends at the given points and has increasing cumulative distance', () => {
  const a = { latitude: 13.0827, longitude: 80.2707 };
  const b = { latitude: 12.9716, longitude: 77.5946 };
  const route = geo.generateRoute(a, b, { rng: createRng(1) });
  assert.deepEqual(route[0], a);
  assert.deepEqual(route[route.length - 1], b);
  const cumulative = geo.cumulativeDistances(route);
  for (let i = 1; i < cumulative.length; i += 1) assert.ok(cumulative[i] > cumulative[i - 1]);
  assert.ok(geo.routeLengthKm(route) >= geo.haversineKm(a, b));
});

test('distanceToPolylineKm is ~0 on the route and grows away from it', () => {
  const a = { latitude: 10, longitude: 78 };
  const b = { latitude: 10, longitude: 79 };
  const route = [a, b];
  assert.ok(geo.distanceToPolylineKm({ latitude: 10, longitude: 78.5 }, route) < 0.01);
  const off = geo.distanceToPolylineKm({ latitude: 10.1, longitude: 78.5 }, route);
  assert.ok(off > 10 && off < 12, `got ${off}`);
});

test('compliance score = normal / total x 100', () => {
  assert.equal(computeScore(95, 100), 95);
  assert.equal(computeScore(2, 3), 66.67);
  assert.equal(computeScore(0, 0), null);
});

test('summarizeReadings and findExcursionEvents', () => {
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  const mk = (i, temperature, status) => ({ temperature, status, timestamp: new Date(t0 + i * 60000) });
  const readings = [
    mk(0, 5, 'NORMAL'),
    mk(1, 8.5, 'EXCURSION'),
    mk(2, 9.5, 'EXCURSION'),
    mk(3, 6, 'NORMAL'),
    mk(4, 1, 'EXCURSION'),
    mk(5, 5, 'NORMAL'),
  ];
  const summary = summarizeReadings(readings);
  assert.equal(summary.total, 6);
  assert.equal(summary.normal, 3);
  assert.equal(summary.excursions, 3);
  assert.equal(summary.min, 1);
  assert.equal(summary.max, 9.5);

  const events = findExcursionEvents(readings, { min: 2, max: 8 });
  assert.equal(events.length, 2);
  assert.equal(events[0].direction, 'HIGH');
  assert.equal(events[0].readings, 2);
  assert.equal(events[0].peakTemperature, 9.5);
  assert.equal(events[0].peakDeviation, 1.5);
  assert.equal(events[1].direction, 'LOW');
});

test('downsample keeps the last element and respects the limit', () => {
  const items = Array.from({ length: 1000 }, (_, i) => i);
  const out = downsample(items, 100);
  assert.ok(out.length <= 101);
  assert.equal(out[out.length - 1], 999);
  assert.equal(downsample([1, 2, 3], 10).length, 3);
});

test('pagination helpers clamp and whitelist', () => {
  assert.deepEqual(parsePagination({ page: '3', limit: '10' }), { page: 3, limit: 10, skip: 20 });
  assert.equal(parsePagination({ limit: '100000' }).limit, 100);
  assert.equal(parsePagination({ page: '-4' }).page, 1);
  assert.deepEqual(buildMeta(2, 10, 35), { page: 2, limit: 10, total: 35, totalPages: 4 });
  assert.deepEqual(parseSort('-createdAt,name,evil', ['createdAt', 'name']), { createdAt: -1, name: 1 });
  assert.deepEqual(parseSort('evil', ['name'], { name: 1 }), { name: 1 });
});

test('escapeRegex neutralises regex metacharacters', () => {
  const rx = new RegExp(escapeRegex('a.b*(c)'));
  assert.ok(rx.test('xa.b*(c)y'));
  assert.ok(!rx.test('aXbbbc'));
});

test('AppError helpers carry status codes', () => {
  assert.equal(AppError.badRequest().statusCode, 400);
  assert.equal(AppError.unauthorized().statusCode, 401);
  assert.equal(AppError.forbidden().statusCode, 403);
  assert.equal(AppError.notFound().statusCode, 404);
  assert.equal(AppError.conflict().statusCode, 409);
});
