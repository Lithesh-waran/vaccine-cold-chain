'use strict';

const { SCENARIO } = require('../config/constants');
const AppError = require('../utils/AppError');

/**
 * Scenario manager: injects controlled failures into a running ShipmentSimulator ("engine").
 * The engine exposes .temperature, .vehicle, .gps, .tickCount, .opts and .scenario.
 * Scenarios are applied gradually and finish on their own (returning the engine to NORMAL).
 */

const num = (value, name, { min, max, integer = false, fallback } = {}) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw AppError.badRequest(`options.${name} must be a number`);
  if (integer && !Number.isInteger(n)) throw AppError.badRequest(`options.${name} must be an integer`);
  if (min !== undefined && n < min) throw AppError.badRequest(`options.${name} must be >= ${min}`);
  if (max !== undefined && n > max) throw AppError.badRequest(`options.${name} must be <= ${max}`);
  return n;
};

const normalScenario = (tick = 0) => ({ name: SCENARIO.NORMAL, startedAtTick: tick, endsAtTick: null, options: {} });

const DEFINITIONS = {
  [SCENARIO.NORMAL]: {
    description: 'Clears any active failure; the shipment travels normally.',
    options: {},
    normalize: () => ({}),
    apply() {},
    step: () => true,
  },

  [SCENARIO.TEMPERATURE_EXCURSION]: {
    description: 'Temperature drifts smoothly beyond the allowed limit, holds, then recovers.',
    options: {
      direction: "'HIGH' (default) or 'LOW'",
      overshootC: 'degrees beyond the limit the temperature is pushed towards',
      rampTicks: 'ticks to reach the peak (default 6)',
      holdTicks: 'ticks the peak is held (default 8)',
      recoverTicks: 'ticks to return to normal (default 8)',
    },
    normalize(raw) {
      const direction = String(raw.direction || 'HIGH').toUpperCase();
      if (!['HIGH', 'LOW'].includes(direction)) throw AppError.badRequest("options.direction must be 'HIGH' or 'LOW'");
      return {
        direction,
        overshootC: num(raw.overshootC, 'overshootC', { min: 0.5, max: 100 }),
        rampTicks: num(raw.rampTicks, 'rampTicks', { min: 1, max: 500, integer: true, fallback: 6 }),
        holdTicks: num(raw.holdTicks, 'holdTicks', { min: 0, max: 500, integer: true, fallback: 8 }),
        recoverTicks: num(raw.recoverTicks, 'recoverTicks', { min: 1, max: 500, integer: true, fallback: 8 }),
      };
    },
    apply(engine, o) {
      engine.temperature.startExcursion({
        direction: o.direction,
        overshoot: o.overshootC,
        rampTicks: o.rampTicks,
        holdTicks: o.holdTicks,
        recoverTicks: o.recoverTicks,
      });
    },
    step: (engine) => !engine.temperature.isExcursionActive(),
  },

  [SCENARIO.VEHICLE_DELAY]: {
    description: 'Vehicle stops, then crawls at reduced speed, pushing arrival past the expected delivery.',
    options: {
      stopMinutes: 'simulated minutes the vehicle is stopped (default: max(45, 50% of planned trip))',
      slowMinutes: 'simulated minutes the vehicle then crawls (default: 50% of planned trip)',
      slowFactor: 'fraction of cruise speed while crawling, 0.1 - 0.9 (default 0.4)',
    },
    normalize(raw) {
      return {
        stopMinutes: num(raw.stopMinutes, 'stopMinutes', { min: 0, max: 100000 }),
        slowMinutes: num(raw.slowMinutes, 'slowMinutes', { min: 0, max: 100000 }),
        slowFactor: num(raw.slowFactor, 'slowFactor', { min: 0.1, max: 0.9, fallback: 0.4 }),
      };
    },
    apply(engine, o) {
      const plannedMinutes = engine.plannedTripMinutes();
      const stopMinutes = o.stopMinutes !== undefined ? o.stopMinutes : Math.max(45, plannedMinutes * 0.5);
      const slowMinutes = o.slowMinutes !== undefined ? o.slowMinutes : plannedMinutes * 0.5;
      engine.vehicle.startDelay({
        stopSimSeconds: stopMinutes * 60,
        slowSimSeconds: slowMinutes * 60,
        slowFactor: o.slowFactor,
      });
    },
    step: (engine) => !engine.vehicle.isDelayActive(),
  },

  [SCENARIO.ROUTE_DEVIATION]: {
    description: 'Vehicle drifts sideways away from the planned route, then returns.',
    options: {
      offsetKm: 'how far off the route the vehicle drifts (default: 3x route tolerance)',
      durationTicks: 'ticks before the vehicle steers back (default 20)',
    },
    normalize(raw) {
      return {
        offsetKm: num(raw.offsetKm, 'offsetKm', { min: 0.1, max: 500 }),
        durationTicks: num(raw.durationTicks, 'durationTicks', { min: 1, max: 5000, integer: true, fallback: 20 }),
      };
    },
    apply(engine, o) {
      engine.gps.setDeviation(o.offsetKm !== undefined ? o.offsetKm : engine.toleranceKm * 3);
    },
    endsAfterTicks: (o) => o.durationTicks,
    step(engine, scenario) {
      if (engine.tickCount >= scenario.endsAtTick) engine.gps.clearDeviation();
      return engine.tickCount >= scenario.endsAtTick && engine.gps.deviationKm <= 0.001;
    },
  },

  [SCENARIO.SENSOR_FAILURE]: {
    description: 'Temperature sensor stops reporting (no readings) and then comes back.',
    options: {
      durationTicks: 'ticks the sensor stays silent (default: long enough to exceed the sensor timeout + 4)',
    },
    normalize(raw, engine) {
      const fallback = Math.ceil(engine.opts.sensorTimeoutMs / engine.tickIntervalMs) + 4;
      return { durationTicks: num(raw.durationTicks, 'durationTicks', { min: 1, max: 5000, integer: true, fallback }) };
    },
    apply(engine) {
      engine.temperature.failSensor();
    },
    endsAfterTicks: (o) => o.durationTicks,
    step(engine, scenario) {
      if (engine.tickCount >= scenario.endsAtTick) {
        engine.temperature.restoreSensor();
        return true;
      }
      return false;
    },
  },
};

function listScenarios() {
  return Object.entries(DEFINITIONS).map(([name, def]) => ({
    name,
    description: def.description,
    options: def.options,
  }));
}

/** Removes any abnormal condition so a new scenario starts from a clean slate. */
function clearConditions(engine) {
  engine.temperature.endExcursion();
  engine.temperature.restoreSensor();
  engine.vehicle.clearDelay();
  engine.gps.clearDeviation();
}

/**
 * Applies a scenario to an engine and records it on engine.scenario.
 * @returns the active scenario descriptor
 */
function apply(engine, name, rawOptions = {}) {
  const key = String(name || '').toUpperCase();
  const def = DEFINITIONS[key];
  if (!def) {
    throw AppError.badRequest(`Unknown scenario "${name}". Valid scenarios: ${Object.keys(DEFINITIONS).join(', ')}`);
  }
  if (rawOptions === null || typeof rawOptions !== 'object' || Array.isArray(rawOptions)) {
    throw AppError.badRequest('options must be an object');
  }

  const options = def.normalize(rawOptions, engine);
  clearConditions(engine);
  def.apply(engine, options);

  engine.scenario =
    key === SCENARIO.NORMAL
      ? normalScenario(engine.tickCount)
      : {
          name: key,
          startedAtTick: engine.tickCount,
          endsAtTick: def.endsAfterTicks ? engine.tickCount + def.endsAfterTicks(options) : null,
          options,
        };
  return engine.scenario;
}

/**
 * Called by the engine at the end of every tick. Returns true when the active scenario has just finished
 * (the engine is then switched back to NORMAL).
 */
function tick(engine) {
  const scenario = engine.scenario;
  if (!scenario || scenario.name === SCENARIO.NORMAL) return false;
  const def = DEFINITIONS[scenario.name];
  if (def.step(engine, scenario)) {
    engine.scenario = normalScenario(engine.tickCount);
    return true;
  }
  return false;
}

module.exports = { apply, tick, listScenarios, clearConditions, normalScenario, SCENARIOS: Object.keys(DEFINITIONS) };
