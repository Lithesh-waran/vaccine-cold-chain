'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeShipment, makeFakeDeps, makeClock } = require('./helpers');

const { ShipmentSimulator } = require('../src/simulation/shipmentSimulator');
const { TemperatureSimulator } = require('../src/simulation/temperatureSimulator');
const { GpsSimulator } = require('../src/simulation/gpsSimulator');
const scenarioManager = require('../src/simulation/scenarioManager');
const { createRng } = require('../src/utils/random');

const TICK_MS = 3000;

function buildEngine(shipmentOverrides = {}, options = {}) {
  const shipment = makeShipment(shipmentOverrides);
  const { state, deps } = makeFakeDeps();
  const clock = makeClock();
  const engine = new ShipmentSimulator(
    shipment,
    { tickIntervalMs: TICK_MS, timeScale: 60, rng: createRng(42), clock, ...options },
    deps
  );
  return { engine, state, clock, shipment };
}

/** Runs ticks (advancing the fake wall clock) until the shipment completes or maxTicks is reached. */
async function runUntil(ctx, { maxTicks = 3000, stop = () => false } = {}) {
  const results = [];
  for (let i = 0; i < maxTicks; i += 1) {
    ctx.clock.advance(TICK_MS);
    const result = await ctx.engine.tick();
    results.push(result);
    if (result.completed || stop(result, i)) break;
  }
  return results;
}

test('TemperatureSimulator stays inside the limits and changes smoothly in normal operation', () => {
  const sim = new TemperatureSimulator({ min: 2, max: 8, rng: createRng(3) });
  let previous = null;
  for (let i = 0; i < 500; i += 1) {
    const { temperature } = sim.next();
    assert.ok(temperature >= 2 && temperature <= 8, `tick ${i}: ${temperature}`);
    if (previous !== null) assert.ok(Math.abs(temperature - previous) < 1, `jump of ${Math.abs(temperature - previous)}`);
    previous = temperature;
  }
});

test('TemperatureSimulator excursion ramps up, holds and recovers without jumps', () => {
  const sim = new TemperatureSimulator({ min: 2, max: 8, rng: createRng(5) });
  for (let i = 0; i < 10; i += 1) sim.next();
  sim.startExcursion({ direction: 'HIGH', overshoot: 3, rampTicks: 6, holdTicks: 4, recoverTicks: 6 });
  const values = [];
  for (let i = 0; i < 60; i += 1) values.push(sim.next().temperature);
  assert.ok(Math.max(...values) > 8, 'temperature should exceed the upper limit');
  for (let i = 1; i < values.length; i += 1) assert.ok(Math.abs(values[i] - values[i - 1]) < 2.5, `jump at ${i}`);
  assert.equal(sim.isExcursionActive(), false);
  assert.ok(values[values.length - 1] <= 8, 'temperature recovers into range');
});

test('TemperatureSimulator sensor failure produces no reading and can be restored', () => {
  const sim = new TemperatureSimulator({ min: 2, max: 8, rng: createRng(1) });
  sim.failSensor();
  assert.equal(sim.next().temperature, null);
  sim.restoreSensor();
  assert.notEqual(sim.next().temperature, null);
});

test('GpsSimulator moves progressively along the route and arrives', () => {
  const route = makeShipment().route;
  const gps = new GpsSimulator(route, { rng: createRng(2) });
  let last = -1;
  let state;
  for (let i = 0; i < 1000; i += 1) {
    state = gps.advance(1.5);
    assert.ok(state.distanceKm >= last);
    last = state.distanceKm;
    if (state.arrived) break;
  }
  assert.equal(state.arrived, true);
  assert.equal(state.progress, 1);
});

test('normal trip: completes, stays within limits, raises no temperature/route/sensor alerts', async () => {
  const ctx = buildEngine();
  const results = await runUntil(ctx);
  const last = results[results.length - 1];

  assert.equal(last.completed, true, 'shipment should be delivered');
  assert.ok(ctx.state.delivered, 'markDelivered was called');
  assert.ok(ctx.state.delivered.actualDelivery instanceof Date);
  assert.equal(ctx.state.arrivals, 1, 'inventory arrival booked exactly once');
  assert.ok(ctx.state.temperatures.every((t) => t.status === 'NORMAL'));
  assert.equal(ctx.state.temperatures.length, results.length);
  const types = ctx.state.alerts.map((a) => a.type);
  for (const forbidden of ['TEMPERATURE_EXCURSION', 'ROUTE_DEVIATION', 'SENSOR_FAILURE']) {
    assert.ok(!types.includes(forbidden), `unexpected ${forbidden}`);
  }

  const progress = ctx.state.events.filter((e) => e.event === 'location:update').map((e) => e.payload.progress);
  for (let i = 1; i < progress.length; i += 1) assert.ok(progress[i] >= progress[i - 1], 'progress never goes backwards');
  assert.equal(progress[progress.length - 1], 100);

  const eventNames = new Set(ctx.state.events.map((e) => e.event));
  for (const name of ['temperature:update', 'location:update', 'shipment:update']) assert.ok(eventNames.has(name), name);
  assert.ok(ctx.state.inventoryChecks >= 1, 'inventory conditions are checked');
});

test('TEMPERATURE_EXCURSION scenario raises exactly one CRITICAL alert and marks the shipment CRITICAL', async () => {
  const ctx = buildEngine();
  ctx.engine.applyScenario('TEMPERATURE_EXCURSION', { direction: 'HIGH', overshootC: 3, rampTicks: 4, holdTicks: 5, recoverTicks: 4 });
  await runUntil(ctx, { maxTicks: 60 });

  const alerts = ctx.state.alerts.filter((a) => a.type === 'TEMPERATURE_EXCURSION');
  assert.equal(alerts.length, 1, 'duplicate active alerts must be prevented');
  assert.equal(alerts[0].severity, 'CRITICAL');
  assert.ok(ctx.state.temperatures.some((t) => t.status === 'EXCURSION'));
  assert.ok(ctx.state.statuses.includes('CRITICAL'));
  assert.equal(ctx.engine.scenario.name, 'NORMAL', 'scenario ends by itself');
});

test('SENSOR_FAILURE scenario: no readings while failed, SENSOR_FAILURE alert after the timeout', async () => {
  const ctx = buildEngine({}, { sensorTimeoutMs: 10000 });
  ctx.engine.applyScenario('SENSOR_FAILURE', { durationTicks: 8 });
  const results = await runUntil(ctx, { maxTicks: 8 });

  assert.equal(ctx.state.temperatures.length, 0, 'no temperature readings while the sensor is down');
  const alert = ctx.state.alerts.find((a) => a.type === 'SENSOR_FAILURE');
  assert.ok(alert, 'SENSOR_FAILURE alert expected');
  assert.equal(alert.severity, 'CRITICAL');
  assert.equal(results.length, 8);

  await runUntil(ctx, { maxTicks: 3 });
  assert.ok(ctx.state.temperatures.length > 0, 'readings resume after the failure');
});

test('ROUTE_DEVIATION scenario: vehicle leaves the route, WARNING alert, then returns', async () => {
  const ctx = buildEngine();
  ctx.engine.applyScenario('ROUTE_DEVIATION', { offsetKm: 6, durationTicks: 12 });
  let maxDeviation = 0;
  await runUntil(ctx, {
    maxTicks: 80,
    stop: () => {
      maxDeviation = Math.max(maxDeviation, ctx.engine.lastGps.distanceFromRouteKm);
      return false;
    },
  });
  const alert = ctx.state.alerts.find((a) => a.type === 'ROUTE_DEVIATION');
  assert.ok(alert, 'ROUTE_DEVIATION alert expected');
  assert.equal(alert.severity, 'WARNING');
  assert.ok(maxDeviation > 2, `deviation ${maxDeviation}`);
  assert.equal(ctx.engine.scenario.name, 'NORMAL');
});

test('VEHICLE_DELAY scenario: vehicle stops, shipment becomes DELAYED and a SHIPMENT_DELAY alert is raised', async () => {
  const ctx = buildEngine();
  ctx.engine.applyScenario('VEHICLE_DELAY', { stopMinutes: 240, slowMinutes: 120, slowFactor: 0.3 });
  const results = await runUntil(ctx);

  assert.ok(ctx.state.statuses.includes('DELAYED'), 'status DELAYED expected');
  assert.ok(ctx.state.updates.some((u) => u['vehicle.state'] === 'STOPPED' || u['vehicle.state'] === 'DELAYED'));
  const alert = ctx.state.alerts.find((a) => a.type === 'SHIPMENT_DELAY');
  assert.ok(alert, 'SHIPMENT_DELAY alert expected');
  assert.equal(alert.severity, 'WARNING');
  assert.equal(results[results.length - 1].completed, true, 'the shipment is still delivered eventually');
});

test('scenarioManager rejects unknown scenarios and bad options', () => {
  const { engine } = buildEngine();
  assert.throws(() => scenarioManager.apply(engine, 'MELTDOWN'), (e) => e.statusCode === 400);
  assert.throws(() => scenarioManager.apply(engine, 'TEMPERATURE_EXCURSION', { direction: 'SIDEWAYS' }), (e) => e.statusCode === 400);
  assert.throws(() => scenarioManager.apply(engine, 'VEHICLE_DELAY', { slowFactor: 5 }), (e) => e.statusCode === 400);
  assert.equal(scenarioManager.listScenarios().length, 5);
});

test('an aborted engine does no more work', async () => {
  const ctx = buildEngine();
  ctx.engine.abort();
  const result = await ctx.engine.tick();
  assert.deepEqual(result, { aborted: true });
  assert.equal(ctx.state.temperatures.length, 0);
});

test('an engine resumes from the persisted snapshot', async () => {
  const first = buildEngine();
  await runUntil(first, { maxTicks: 10 });
  const snapshot = {
    state: 'RUNNING',
    progressKm: first.engine.lastGps.distanceKm,
    ticks: first.engine.tickCount,
    simTime: first.engine.simTime,
  };
  const second = buildEngine({ simulation: snapshot, currentTemperature: 5 });
  assert.equal(second.engine.resumed, true);
  assert.equal(second.engine.tickCount, 10);
  assert.ok(Math.abs(second.engine.gps.getState().distanceKm - snapshot.progressKm) < 0.5);
});
