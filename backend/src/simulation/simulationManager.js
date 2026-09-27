'use strict';

const {
  SHIPMENT_STATUS,
  SIM_STATE,
  SOCKET_EVENTS,
  SCENARIO,
} = require('../config/constants');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const scenarioManager = require('./scenarioManager');
const { ShipmentSimulator } = require('./shipmentSimulator');

const MAX_CONSECUTIVE_ERRORS = 5;

/**
 * Owns the lifecycle of all running simulations: one independent ShipmentSimulator per shipment,
 * each driven by its own self-rescheduling setTimeout (never overlapping ticks).
 *
 * Timer hygiene: every entry has at most one pending timer; timers are cleared on pause / stop / reset /
 * completion / shutdown, and entries are removed from the registry when they end.
 */
class SimulationManager {
  /**
   * @param {object} [deps]     shared collaborators (see ./deps.js); defaults are loaded lazily
   * @param {object} [defaults] engine defaults; by default taken from config/env
   */
  constructor(deps = null, defaults = null) {
    this._deps = deps;
    this._defaults = defaults;
    /** @type {Map<string, {key: string, state: string, engine: ShipmentSimulator|null, timer: NodeJS.Timeout|null,
     *  busy: boolean, inflight: Promise|null, errors: number}>} */
    this.sessions = new Map();
  }

  get deps() {
    if (!this._deps) this._deps = require('./deps').createDefaultDeps();
    return this._deps;
  }

  get defaults() {
    if (!this._defaults) this._defaults = { ...require('../config/env').simulation };
    return this._defaults;
  }

  activeCount() {
    return this.sessions.size;
  }

  listActive() {
    return [...this.sessions.values()]
      .filter((entry) => entry.engine)
      .map((entry) => ({ ...entry.engine.getStatus(), state: entry.state }));
  }

  /** Scenario catalogue (for the API / UI). */
  scenarios() {
    return scenarioManager.listScenarios();
  }

  // --------------------------------------------------------------------- lifecycle

  /**
   * Starts (or resumes after a restart / stop) the simulation of a shipment. A shipment that is still
   * PREPARING is first put into transit (stock is deducted from the source warehouse).
   */
  async start(ref, options = {}) {
    const { shipmentService } = this.deps;
    let shipment = await shipmentService.getByRef(ref);
    const key = String(shipment._id);

    if (this.sessions.has(key)) {
      const state = this.sessions.get(key).state;
      throw AppError.conflict(`Simulation for this shipment is already ${state.toLowerCase()}`);
    }
    if ([SHIPMENT_STATUS.DELIVERED, SHIPMENT_STATUS.CANCELLED].includes(shipment.status)) {
      throw AppError.conflict(`Cannot simulate a ${shipment.status} shipment (use reset to replay it)`);
    }

    // Reserve the slot synchronously (no await between the check above and this line) to avoid double starts.
    const entry = { key, state: 'STARTING', engine: null, timer: null, busy: false, inflight: null, errors: 0 };
    this.sessions.set(key, entry);

    try {
      if (shipment.status === SHIPMENT_STATUS.PREPARING) {
        shipment = await shipmentService.beginTransit(shipment);
      }

      const engineOptions = { ...this.defaults };
      if (options.timeScale !== undefined) engineOptions.timeScale = options.timeScale;
      if (options.tickIntervalMs !== undefined) engineOptions.tickIntervalMs = options.tickIntervalMs;

      const engine = new ShipmentSimulator(shipment, engineOptions, this.deps);
      if (options.scenario && String(options.scenario).toUpperCase() !== SCENARIO.NORMAL) {
        engine.applyScenario(options.scenario, options.scenarioOptions || {});
      }

      entry.engine = engine;
      entry.state = SIM_STATE.RUNNING;
      await shipmentService.applySimulationUpdate(key, engine.snapshotPatch(SIM_STATE.RUNNING));

      this._emit(entry, SOCKET_EVENTS.SIMULATION_STARTED, { ...this._payload(entry), resumed: engine.resumed });
      this._schedule(entry, 0);
      logger.info(`Simulation started for ${engine.code} (timeScale x${engine.timeScale}, tick ${engine.tickIntervalMs} ms)`);
      return { shipment, simulation: this._describe(entry) };
    } catch (err) {
      this._discard(entry);
      throw err;
    }
  }

  async pause(ref) {
    const entry = await this._activeEntry(ref);
    if (entry.state !== SIM_STATE.RUNNING) {
      throw AppError.conflict(`Simulation is ${entry.state.toLowerCase()}, only a running simulation can be paused`);
    }
    entry.state = SIM_STATE.PAUSED;
    this._clearTimer(entry);
    await this._persistState(entry, SIM_STATE.PAUSED);
    this._emit(entry, SOCKET_EVENTS.SIMULATION_PAUSED, this._payload(entry));
    return this._describe(entry);
  }

  async resume(ref) {
    const entry = await this._activeEntry(ref);
    if (entry.state !== SIM_STATE.PAUSED) {
      throw AppError.conflict(`Simulation is ${entry.state.toLowerCase()}, only a paused simulation can be resumed`);
    }
    entry.engine.onResume();
    entry.state = SIM_STATE.RUNNING;
    await this._persistState(entry, SIM_STATE.RUNNING);
    this._emit(entry, SOCKET_EVENTS.SIMULATION_STARTED, { ...this._payload(entry), resumed: true });
    this._schedule(entry, entry.engine.tickIntervalMs);
    return this._describe(entry);
  }

  /** Stops the simulation; the shipment keeps its progress and can be started again later. */
  async stop(ref) {
    const { shipmentService } = this.deps;
    const shipment = await shipmentService.getByRef(ref);
    const key = String(shipment._id);
    const entry = this.sessions.get(key);

    if (!entry) {
      const persisted = shipment.simulation && shipment.simulation.state;
      if (persisted === SIM_STATE.RUNNING || persisted === SIM_STATE.PAUSED) {
        // stale snapshot left over from a crash / restart
        await shipmentService.applySimulationUpdate(key, {
          'simulation.state': SIM_STATE.STOPPED,
          'simulation.updatedAt': new Date(),
        });
        return this.status(key);
      }
      throw AppError.conflict('There is no active simulation for this shipment');
    }

    await this._halt(entry);
    await shipmentService.applySimulationUpdate(key, {
      'simulation.state': SIM_STATE.STOPPED,
      'simulation.updatedAt': new Date(),
    });
    this._emit(entry, SOCKET_EVENTS.SIMULATION_STOPPED, { ...this._payload(entry), reason: 'stopped' });
    return this.status(key);
  }

  /** Stops a simulation if one is active (used when a shipment is cancelled or deleted). */
  async stopIfActive(shipmentDbId, reason = 'shipment-changed') {
    const entry = this.sessions.get(String(shipmentDbId));
    if (!entry) return false;
    await this._halt(entry);
    await this.deps.shipmentService
      .applySimulationUpdate(entry.key, { 'simulation.state': SIM_STATE.STOPPED, 'simulation.updatedAt': new Date() })
      .catch((err) => logger.warn(`Could not persist stopped state: ${err.message}`));
    this._emit(entry, SOCKET_EVENTS.SIMULATION_STOPPED, { ...this._payload(entry), reason });
    return true;
  }

  /**
   * Resets the shipment to its initial PREPARING state: stops the simulation, discards generated
   * readings and alerts and reverts inventory movements.
   */
  async reset(ref) {
    const { shipmentService, emitter } = this.deps;
    const shipment = await shipmentService.getByRef(ref);
    const key = String(shipment._id);

    const entry = this.sessions.get(key);
    if (entry) await this._halt(entry);

    const fresh = await shipmentService.resetShipment(shipment);
    const payload = {
      shipmentId: key,
      shipmentCode: shipment.shipmentId,
      state: SIM_STATE.IDLE,
      scenario: SCENARIO.NORMAL,
      reason: 'reset',
    };
    emitter.emitToShipment(key, SOCKET_EVENTS.SIMULATION_STOPPED, payload);
    emitter.emitToShipment(key, SOCKET_EVENTS.SHIPMENT_UPDATE, {
      shipmentId: key,
      shipmentCode: shipment.shipmentId,
      status: fresh.status,
      currentTemperature: fresh.currentTemperature,
      currentLatitude: fresh.currentLatitude,
      currentLongitude: fresh.currentLongitude,
      progress: 0,
    });
    return this.status(key);
  }

  async applyScenario(ref, scenario, options = {}) {
    const entry = await this._activeEntry(ref);
    if (entry.state !== SIM_STATE.RUNNING && entry.state !== SIM_STATE.PAUSED) {
      throw AppError.conflict('Simulation is not running');
    }
    const applied = entry.engine.applyScenario(scenario, options);
    this._emit(entry, SOCKET_EVENTS.SIMULATION_UPDATE, { ...this._payload(entry), event: 'scenario-applied' });
    return { scenario: applied, simulation: this._describe(entry) };
  }

  async status(ref) {
    const shipment = await this.deps.shipmentService.getByRef(ref);
    const key = String(shipment._id);
    const entry = this.sessions.get(key);
    if (entry && entry.engine) return this._describe(entry);

    const snap = shipment.simulation || {};
    return {
      active: false,
      shipmentId: key,
      shipmentCode: shipment.shipmentId,
      state: snap.state || SIM_STATE.IDLE,
      status: shipment.status,
      scenario: { name: snap.scenario || SCENARIO.NORMAL },
      progress: snap.progress || 0,
      distanceKm: snap.progressKm || 0,
      totalKm: snap.totalKm || 0,
      tick: snap.ticks || 0,
      simTime: snap.simTime || null,
      timeScale: snap.timeScale || null,
      tickIntervalMs: snap.tickIntervalMs || null,
      vehicle: shipment.vehicle || null,
    };
  }

  /** Clears every timer and persists the stopped state. Call on process shutdown. */
  async shutdown() {
    const entries = [...this.sessions.values()];
    for (const entry of entries) {
      this._clearTimer(entry);
      if (entry.engine) entry.engine.abort();
    }
    await Promise.allSettled(entries.map((e) => (e.inflight ? e.inflight : Promise.resolve())));
    await Promise.allSettled(
      entries.map((entry) =>
        this.deps.shipmentService.applySimulationUpdate(entry.key, {
          'simulation.state': SIM_STATE.STOPPED,
          'simulation.updatedAt': new Date(),
        })
      )
    );
    this.sessions.clear();
  }

  // --------------------------------------------------------------------- internals

  async _activeEntry(ref) {
    const shipment = await this.deps.shipmentService.getByRef(ref);
    const entry = this.sessions.get(String(shipment._id));
    if (!entry || !entry.engine) {
      throw AppError.conflict('There is no active simulation for this shipment. Start it first.');
    }
    return entry;
  }

  _schedule(entry, delayMs) {
    this._clearTimer(entry);
    entry.timer = setTimeout(() => this._run(entry), delayMs);
  }

  _clearTimer(entry) {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  }

  async _run(entry) {
    entry.timer = null;
    if (entry.state !== SIM_STATE.RUNNING || this.sessions.get(entry.key) !== entry) return;
    if (entry.busy) {
      this._schedule(entry, entry.engine.tickIntervalMs);
      return;
    }

    entry.busy = true;
    entry.inflight = this._tick(entry);
    try {
      await entry.inflight;
    } finally {
      entry.busy = false;
      entry.inflight = null;
    }

    if (entry.state === SIM_STATE.RUNNING && this.sessions.get(entry.key) === entry && !entry.timer) {
      this._schedule(entry, entry.engine.tickIntervalMs);
    }
  }

  /** One guarded tick; never rejects. */
  async _tick(entry) {
    try {
      const result = await entry.engine.tick();
      entry.errors = 0;
      if (result.aborted) return;

      this._emit(entry, SOCKET_EVENTS.SIMULATION_UPDATE, this._payload(entry));
      if (result.completed) await this._complete(entry);
    } catch (err) {
      entry.errors += 1;
      logger.error(`Simulation tick failed for ${entry.engine.code} (${entry.errors}/${MAX_CONSECUTIVE_ERRORS}):`, err.message);
      if (entry.errors >= MAX_CONSECUTIVE_ERRORS) await this._failStop(entry, err);
    }
  }

  async _complete(entry) {
    entry.state = SIM_STATE.COMPLETED;
    this._clearTimer(entry);
    this.sessions.delete(entry.key);
    const payload = { ...this._payload(entry), state: SIM_STATE.COMPLETED, actualDelivery: entry.engine.simTime };
    this._emit(entry, SOCKET_EVENTS.SIMULATION_COMPLETED, payload);
    logger.info(`Simulation completed for ${entry.engine.code}`);
  }

  async _failStop(entry, err) {
    this._clearTimer(entry);
    entry.state = SIM_STATE.STOPPED;
    entry.engine.abort();
    this.sessions.delete(entry.key);
    await this.deps.shipmentService
      .applySimulationUpdate(entry.key, { 'simulation.state': SIM_STATE.STOPPED, 'simulation.updatedAt': new Date() })
      .catch(() => {});
    this._emit(entry, SOCKET_EVENTS.SIMULATION_STOPPED, {
      ...this._payload(entry),
      reason: 'error',
      error: err.message,
    });
  }

  /** Cancels the timer, aborts the engine, waits for an in-flight tick and removes the entry. */
  async _halt(entry) {
    entry.state = SIM_STATE.STOPPED;
    this._clearTimer(entry);
    if (entry.engine) entry.engine.abort();
    if (entry.inflight) await entry.inflight.catch(() => {});
    this.sessions.delete(entry.key);
  }

  _discard(entry) {
    this._clearTimer(entry);
    if (entry.engine) entry.engine.abort();
    if (this.sessions.get(entry.key) === entry) this.sessions.delete(entry.key);
  }

  async _persistState(entry, state) {
    await this.deps.shipmentService.applySimulationUpdate(entry.key, {
      'simulation.state': state,
      'simulation.updatedAt': new Date(),
    });
  }

  _describe(entry) {
    return { ...entry.engine.getStatus(), active: true, state: entry.state };
  }

  _payload(entry) {
    const s = entry.engine.getStatus();
    return {
      shipmentId: s.shipmentId,
      shipmentCode: s.shipmentCode,
      state: entry.state,
      status: s.status,
      scenario: s.scenario.name,
      tick: s.tick,
      progress: s.progress,
      simTime: s.simTime,
      timeScale: s.timeScale,
      tickIntervalMs: s.tickIntervalMs,
      vehicle: s.vehicle,
    };
  }

  _emit(entry, event, payload) {
    this.deps.emitter.emitToShipment(entry.key, event, payload);
  }
}

const simulationManager = new SimulationManager();

module.exports = simulationManager;
module.exports.SimulationManager = SimulationManager;
