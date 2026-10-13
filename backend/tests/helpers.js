'use strict';

const { generateRoute } = require('../src/utils/geo');
const { createRng } = require('../src/utils/random');

process.env.NODE_ENV = 'test';

/** A ~130 km shipment: about 50 ticks at timeScale 60 / 3 s ticks. */
function makeShipment(overrides = {}) {
  const source = { name: 'Origin', latitude: 13.0827, longitude: 80.2707, warehouseId: 'WH-A' };
  const destination = { name: 'Destination', latitude: 14.0, longitude: 81.0, warehouseId: 'WH-B' };
  return {
    _id: '65f000000000000000000001',
    shipmentId: 'SHP-TEST-001',
    batchId: '65f000000000000000000002',
    quantity: 100,
    source,
    destination,
    route: generateRoute(source, destination, { rng: createRng(7) }),
    status: 'IN_TRANSIT',
    temperatureMin: 2,
    temperatureMax: 8,
    currentTemperature: null,
    routeToleranceKm: 2,
    vehicle: { vehicleId: 'VEH-TEST', state: 'STOPPED', speedKmph: 0 },
    simulation: {},
    ...overrides,
  };
}

/** In-memory replacements for the engine's collaborators. Alerts are de-duplicated like the real alertService. */
function makeFakeDeps() {
  const state = {
    temperatures: [],
    locations: [],
    alerts: [],
    updates: [],
    delivered: null,
    arrivals: 0,
    inventoryChecks: 0,
    events: [],
    statuses: [],
  };
  const deps = {
    readingService: {
      saveTemperatureReading: async (d) => state.temperatures.push(d),
      saveLocationReading: async (d) => state.locations.push(d),
    },
    alertService: {
      raiseAlert: async (input) => {
        if (state.alerts.some((a) => a.type === input.type && !a.resolved)) return { created: false };
        const alert = { ...input, resolved: false };
        state.alerts.push(alert);
        return { created: true, alert };
      },
    },
    shipmentService: {
      applySimulationUpdate: async (id, patch) => {
        state.updates.push(patch);
        if (patch.status) state.statuses.push(patch.status);
      },
      markDelivered: async (id, data) => {
        state.delivered = data;
        return { _id: id, status: 'DELIVERED', ...data };
      },
    },
    inventorySimulator: {
      checkConditions: async () => {
        state.inventoryChecks += 1;
      },
      handleArrival: async () => {
        state.arrivals += 1;
      },
    },
    emitter: { emitToShipment: (id, event, payload) => state.events.push({ event, payload }) },
  };
  return { state, deps };
}

/** Deterministic wall clock that advances by `stepMs` every time it is advanced explicitly. */
function makeClock(start = 1_700_000_000_000) {
  let now = start;
  const clock = () => now;
  clock.advance = (ms) => {
    now += ms;
  };
  return clock;
}

module.exports = { makeShipment, makeFakeDeps, makeClock };
