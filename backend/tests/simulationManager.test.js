'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeShipment, makeFakeDeps } = require('./helpers');

const { SimulationManager } = require('../src/simulation/simulationManager');
const AppError = require('../src/utils/AppError');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition, timeoutMs = 8000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for condition');
    await sleep(10);
  }
}

/** Fake shipmentService backed by a single in-memory shipment. */
function setup() {
  const template = makeShipment({ status: 'PREPARING' });
  let doc = { ...template };
  const fake = makeFakeDeps();

  fake.deps.shipmentService = {
    getByRef: async (ref) => {
      if (ref !== doc._id && ref !== doc.shipmentId) throw AppError.notFound('Shipment not found');
      return { ...doc };
    },
    beginTransit: async () => {
      doc = { ...doc, status: 'IN_TRANSIT', startTime: new Date() };
      return { ...doc };
    },
    applySimulationUpdate: async (id, patch) => {
      fake.state.updates.push(patch);
      doc = {
        ...doc,
        ...(patch.status ? { status: patch.status } : {}),
        simulation: {
          ...doc.simulation,
          ...(patch['simulation.state'] ? { state: patch['simulation.state'] } : {}),
          ...(patch['simulation.progress'] !== undefined ? { progress: patch['simulation.progress'] } : {}),
        },
      };
    },
    markDelivered: async (id, data) => {
      fake.state.delivered = data;
      doc = { ...doc, status: 'DELIVERED' };
      return { ...doc };
    },
    resetShipment: async () => {
      doc = { ...template };
      return { ...doc };
    },
  };

  // 10 ms ticks, 20 000x time: a ~130 km trip lasts about 50 ticks (~0.5 s)
  const manager = new SimulationManager(fake.deps, {
    tickIntervalMs: 10,
    timeScale: 20000,
    cruiseSpeedKmph: 50,
    etaBufferFactor: 1.25,
    sensorTimeoutMs: 10000,
    routeToleranceKm: 2,
    inventoryCheckEveryTicks: 5,
    randomStopChance: 0,
  });
  return { manager, fake, getDoc: () => doc };
}

const eventNames = (fake) => fake.state.events.map((e) => e.event);

test('runs a simulation to completion and cleans up its timer', async () => {
  const { manager, fake, getDoc } = setup();
  try {
    const started = await manager.start('SHP-TEST-001');
    assert.equal(started.simulation.state, 'RUNNING');
    assert.equal(manager.activeCount(), 1);
    await assert.rejects(manager.start('SHP-TEST-001'), (e) => e.statusCode === 409, 'double start is rejected');

    await waitFor(() => manager.activeCount() === 0);
    assert.equal(getDoc().status, 'DELIVERED');
    assert.equal(fake.state.arrivals, 1);
    const names = eventNames(fake);
    assert.ok(names.includes('simulation:started'));
    assert.ok(names.includes('simulation:update'));
    assert.ok(names.includes('simulation:completed'));
    await assert.rejects(manager.start('SHP-TEST-001'), (e) => e.statusCode === 409, 'delivered shipments cannot be restarted');
  } finally {
    await manager.shutdown();
  }
});

test('pause stops ticking, resume continues, stop ends the session', async () => {
  const { manager, fake } = setup();
  try {
    await manager.start('SHP-TEST-001', { timeScale: 200 }); // slow enough not to finish during the test
    await waitFor(() => fake.state.temperatures.length >= 3);

    const paused = await manager.pause('SHP-TEST-001');
    assert.equal(paused.state, 'PAUSED');
    await sleep(30); // let a possibly in-flight tick settle
    const frozen = fake.state.temperatures.length;
    await sleep(120);
    assert.equal(fake.state.temperatures.length, frozen, 'no ticks while paused');
    await assert.rejects(manager.pause('SHP-TEST-001'), (e) => e.statusCode === 409);

    const resumed = await manager.resume('SHP-TEST-001');
    assert.equal(resumed.state, 'RUNNING');
    await waitFor(() => fake.state.temperatures.length > frozen + 2);

    const stopped = await manager.stop('SHP-TEST-001');
    assert.equal(stopped.active, false);
    assert.equal(stopped.state, 'STOPPED');
    assert.equal(manager.activeCount(), 0);
    const afterStop = fake.state.temperatures.length;
    await sleep(80);
    assert.equal(fake.state.temperatures.length, afterStop, 'no ticks after stop');

    const names = eventNames(fake);
    for (const n of ['simulation:started', 'simulation:paused', 'simulation:stopped']) assert.ok(names.includes(n), n);
  } finally {
    await manager.shutdown();
  }
});

test('scenarios can be applied to a running simulation only', async () => {
  const { manager, fake } = setup();
  try {
    await assert.rejects(manager.applyScenario('SHP-TEST-001', 'SENSOR_FAILURE'), (e) => e.statusCode === 409);
    await manager.start('SHP-TEST-001', { timeScale: 200 });
    const result = await manager.applyScenario('SHP-TEST-001', 'TEMPERATURE_EXCURSION', { overshootC: 3 });
    assert.equal(result.scenario.name, 'TEMPERATURE_EXCURSION');
    await assert.rejects(manager.applyScenario('SHP-TEST-001', 'NOPE'), (e) => e.statusCode === 400);
    await waitFor(() => fake.state.alerts.some((a) => a.type === 'TEMPERATURE_EXCURSION'), 8000);
  } finally {
    await manager.shutdown();
  }
});

test('reset returns the shipment to PREPARING and status reports the persisted snapshot', async () => {
  const { manager, getDoc } = setup();
  try {
    await manager.start('SHP-TEST-001', { timeScale: 200 });
    await sleep(60);
    const status = await manager.reset('SHP-TEST-001');
    assert.equal(manager.activeCount(), 0);
    assert.equal(getDoc().status, 'PREPARING');
    assert.equal(status.active, false);
    assert.equal(status.status, 'PREPARING');
  } finally {
    await manager.shutdown();
  }
});

test('unknown shipments give 404 and stop without a session gives 409', async () => {
  const { manager } = setup();
  await assert.rejects(manager.start('SHP-NOPE'), (e) => e.statusCode === 404);
  await assert.rejects(manager.stop('SHP-TEST-001'), (e) => e.statusCode === 409);
});

test('shutdown clears every timer', async () => {
  const { manager, fake } = setup();
  await manager.start('SHP-TEST-001', { timeScale: 200 });
  await sleep(50);
  await manager.shutdown();
  assert.equal(manager.activeCount(), 0);
  const count = fake.state.temperatures.length;
  await sleep(80);
  assert.equal(fake.state.temperatures.length, count);
});
