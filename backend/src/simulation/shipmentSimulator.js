'use strict';

const {
  SHIPMENT_STATUS,
  ALERT_TYPE,
  ALERT_SEVERITY,
  READING_STATUS,
  READING_SOURCE,
  SIM_STATE,
  SOCKET_EVENTS,
  SCENARIO,
  VEHICLE_STATE,
} = require('../config/constants');
const DEFAULTS = require('./defaults');
const { TemperatureSimulator } = require('./temperatureSimulator');
const { GpsSimulator } = require('./gpsSimulator');
const { VehicleSimulator } = require('./vehicleSimulator');
const scenarioManager = require('./scenarioManager');
const { round } = require('../utils/random');
const logger = require('../utils/logger');

/**
 * One independent simulation "engine" per shipment. Every tick it:
 *   1. moves the virtual vehicle              (vehicleSimulator)
 *   2. moves the virtual GPS device           (gpsSimulator)
 *   3. generates a temperature sample         (temperatureSimulator)
 *   4. stores the readings                    (readingService -> MongoDB)
 *   5. emits temperature / location events    (Socket.IO)
 *   6. checks temperature limits, route deviation, delay, sensor failure, inventory (alertService)
 *   7. updates and stores the shipment state  (shipmentService -> MongoDB)
 *   8. emits shipment:update, and completes the delivery when the destination is reached.
 *
 * The engine never touches timers: simulationManager owns the scheduling. All collaborators are injected
 * (defaulting to the real services), which keeps the engine unit-testable without a database.
 */
class ShipmentSimulator {
  /**
   * @param {object} shipment plain (lean) shipment document
   * @param {object} options overrides for ./defaults (tickIntervalMs, timeScale, clock, rng, ...)
   * @param {object} [deps]  { readingService, alertService, shipmentService, inventorySimulator, emitter }
   */
  constructor(shipment, options = {}, deps = null) {
    this.opts = { ...DEFAULTS, ...options };
    this.deps = deps || require('./deps').createDefaultDeps();
    this.shipment = shipment;
    this.shipmentId = String(shipment._id);
    this.code = shipment.shipmentId;
    this.limits = { min: shipment.temperatureMin, max: shipment.temperatureMax };
    this.tickIntervalMs = this.opts.tickIntervalMs;
    this.timeScale = this.opts.timeScale;
    this.clock = this.opts.clock || Date.now;
    this.toleranceKm =
      shipment.routeToleranceKm !== undefined && shipment.routeToleranceKm !== null
        ? shipment.routeToleranceKm
        : this.opts.routeToleranceKm;
    const rng = this.opts.rng || Math.random;

    const snap = shipment.simulation || {};
    const resuming =
      Number(snap.progressKm) > 0 && snap.state !== SIM_STATE.IDLE && snap.state !== SIM_STATE.COMPLETED;

    this.gps = new GpsSimulator(shipment.route, { rng, startDistanceKm: resuming ? snap.progressKm : 0 });
    this.temperature = new TemperatureSimulator({
      min: this.limits.min,
      max: this.limits.max,
      rng,
      initial: Number.isFinite(shipment.currentTemperature) ? shipment.currentTemperature : undefined,
    });
    this.vehicle = new VehicleSimulator({
      vehicleId: (shipment.vehicle && shipment.vehicle.vehicleId) || `VEH-${String(this.code).slice(-6)}`,
      cruiseSpeedKmph: this.opts.cruiseSpeedKmph,
      rng,
      randomStopChance: this.opts.randomStopChance,
    });

    this.tickCount = resuming ? Number(snap.ticks) || 0 : 0;
    this.resumed = resuming;
    this.simTime = new Date(
      resuming && snap.simTime ? snap.simTime : shipment.startTime || this.clock()
    );
    this.expectedDelivery = shipment.expectedDelivery
      ? new Date(shipment.expectedDelivery)
      : new Date(this.simTime.getTime() + this.plannedTripMinutes() * 60000 * this.opts.etaBufferFactor);

    this.lastReadingWallAt = this.clock();
    this.lastReading = {
      temperature: Number.isFinite(shipment.currentTemperature) ? shipment.currentTemperature : null,
      status: READING_STATUS.NORMAL,
      timestamp: this.simTime,
    };
    this.lastGps = this.gps.getState();
    this.scenario = scenarioManager.normalScenario(this.tickCount);
    this.status = shipment.status;
    this.aborted = false;
  }

  plannedTripMinutes() {
    return (this.gps.totalKm / this.opts.cruiseSpeedKmph) * 60;
  }

  /** Injects a scenario (see scenarioManager). */
  applyScenario(name, options = {}) {
    return scenarioManager.apply(this, name, options);
  }

  /** Stops any further work; an in-flight tick will bail out before persisting. */
  abort() {
    this.aborted = true;
  }

  /** Called after a pause so the time spent paused is not mistaken for a silent sensor. */
  onResume() {
    this.lastReadingWallAt = this.clock();
  }

  /** Dotted $set patch describing the persisted simulation snapshot. */
  snapshotPatch(state = SIM_STATE.RUNNING) {
    return {
      'simulation.state': state,
      'simulation.scenario': this.scenario.name,
      'simulation.progressKm': this.lastGps.distanceKm,
      'simulation.totalKm': this.lastGps.totalKm,
      'simulation.progress': round(this.lastGps.progress * 100, 1),
      'simulation.simTime': this.simTime,
      'simulation.timeScale': this.timeScale,
      'simulation.tickIntervalMs': this.tickIntervalMs,
      'simulation.ticks': this.tickCount,
      'simulation.updatedAt': new Date(),
    };
  }

  getStatus() {
    return {
      shipmentId: this.shipmentId,
      shipmentCode: this.code,
      status: this.status,
      tick: this.tickCount,
      simTime: this.simTime,
      timeScale: this.timeScale,
      tickIntervalMs: this.tickIntervalMs,
      scenario: this.scenario,
      progress: round(this.lastGps.progress * 100, 1),
      distanceKm: this.lastGps.distanceKm,
      remainingKm: this.lastGps.remainingKm,
      totalKm: this.lastGps.totalKm,
      expectedDelivery: this.expectedDelivery,
      vehicle: {
        vehicleId: this.vehicle.vehicleId,
        state: this.vehicle.state,
        speedKmph: this.vehicle.speedKmph,
      },
      position: { latitude: this.lastGps.latitude, longitude: this.lastGps.longitude },
      deviationKm: this.lastGps.deviationKm,
      distanceFromRouteKm: this.lastGps.distanceFromRouteKm,
      temperature: {
        last: this.lastReading.temperature,
        status: this.lastReading.status,
        limits: this.limits,
        sensorFailed: this.temperature.sensorFailed,
        excursionActive: this.temperature.isExcursionActive(),
      },
    };
  }

  _emit(event, payload) {
    this.deps.emitter.emitToShipment(this.shipmentId, event, payload);
  }

  /**
   * Runs one simulation step.
   * @returns {Promise<{aborted?: boolean, completed?: boolean, tick?: number, status?: string,
   *                    newAlerts?: object[], scenarioEnded?: boolean}>}
   */
  async tick() {
    if (this.aborted) return { aborted: true };
    const { deps } = this;

    this.tickCount += 1;
    const dtSimSeconds = (this.tickIntervalMs / 1000) * this.timeScale;
    this.simTime = new Date(this.simTime.getTime() + dtSimSeconds * 1000);
    const timestamp = this.simTime;
    const wallNow = this.clock();

    // 1-3. vehicle -> GPS -> temperature
    const vehicle = this.vehicle.next(dtSimSeconds);
    const gps = this.gps.advance((vehicle.speedKmph * dtSimSeconds) / 3600);
    this.lastGps = gps;
    const sample = this.temperature.next();

    let reading = null;
    if (sample.temperature !== null) {
      reading = {
        temperature: sample.temperature,
        status: this.temperature.isWithinLimits(sample.temperature)
          ? READING_STATUS.NORMAL
          : READING_STATUS.EXCURSION,
      };
      this.lastReadingWallAt = wallNow;
      this.lastReading = { ...reading, timestamp };
    }
    const silentMs = wallNow - this.lastReadingWallAt;

    // 4. store readings
    if (reading) {
      await deps.readingService.saveTemperatureReading({
        shipmentId: this.shipmentId,
        temperature: reading.temperature,
        timestamp,
        status: reading.status,
        source: READING_SOURCE.SIMULATION,
      });
    }
    await deps.readingService.saveLocationReading({
      shipmentId: this.shipmentId,
      latitude: gps.latitude,
      longitude: gps.longitude,
      timestamp,
      source: READING_SOURCE.SIMULATION,
    });
    if (this.aborted) return { aborted: true };

    // 5. real-time readings
    if (reading) {
      this._emit(SOCKET_EVENTS.TEMPERATURE_UPDATE, {
        shipmentId: this.shipmentId,
        shipmentCode: this.code,
        temperature: reading.temperature,
        status: reading.status,
        limits: this.limits,
        timestamp,
      });
    }
    this._emit(SOCKET_EVENTS.LOCATION_UPDATE, {
      shipmentId: this.shipmentId,
      shipmentCode: this.code,
      latitude: gps.latitude,
      longitude: gps.longitude,
      progress: round(gps.progress * 100, 1),
      speedKmph: vehicle.speedKmph,
      vehicleState: vehicle.state,
      distanceFromRouteKm: gps.distanceFromRouteKm,
      timestamp,
    });

    // 6. alert engine
    const newAlerts = [];
    const raise = async (input) => {
      const result = await deps.alertService.raiseAlert({ shipmentId: this.shipmentId, timestamp, ...input });
      if (result && result.created) newAlerts.push(result.alert);
    };

    if (reading && reading.status === READING_STATUS.EXCURSION) {
      const tooHot = reading.temperature > this.limits.max;
      await raise({
        type: ALERT_TYPE.TEMPERATURE_EXCURSION,
        severity: ALERT_SEVERITY.CRITICAL,
        message: `Temperature ${reading.temperature}\u00b0C is ${tooHot ? 'above the maximum' : 'below the minimum'} allowed (${
          tooHot ? this.limits.max : this.limits.min
        }\u00b0C) for shipment ${this.code}`,
        value: reading.temperature,
        threshold: tooHot ? this.limits.max : this.limits.min,
      });
    }

    if (!gps.arrived && gps.distanceFromRouteKm > this.toleranceKm) {
      await raise({
        type: ALERT_TYPE.ROUTE_DEVIATION,
        severity: ALERT_SEVERITY.WARNING,
        message: `Vehicle is ${gps.distanceFromRouteKm} km away from the planned route (tolerance ${this.toleranceKm} km)`,
        value: gps.distanceFromRouteKm,
        threshold: this.toleranceKm,
      });
    }

    const overdueMs = timestamp.getTime() - this.expectedDelivery.getTime();
    if (overdueMs > 0) {
      await raise({
        type: ALERT_TYPE.SHIPMENT_DELAY,
        severity: ALERT_SEVERITY.WARNING,
        message: `Shipment ${this.code} is ${Math.max(1, Math.round(overdueMs / 60000))} min past its expected delivery time`,
        value: Math.max(1, Math.round(overdueMs / 60000)),
        threshold: 0,
      });
    }

    const sensorFailed = silentMs > this.opts.sensorTimeoutMs;
    if (sensorFailed) {
      await raise({
        type: ALERT_TYPE.SENSOR_FAILURE,
        severity: ALERT_SEVERITY.CRITICAL,
        message: `No temperature reading received for ${Math.round(silentMs / 1000)} s (timeout ${Math.round(
          this.opts.sensorTimeoutMs / 1000
        )} s)`,
        value: Math.round(silentMs / 1000),
        threshold: Math.round(this.opts.sensorTimeoutMs / 1000),
      });
    }

    // 9. inventory conditions (first tick, then periodically)
    const every = this.opts.inventoryCheckEveryTicks;
    if (this.tickCount === 1 || (every > 0 && this.tickCount % every === 0)) {
      try {
        await deps.inventorySimulator.checkConditions(this.shipment);
      } catch (err) {
        logger.warn(`Inventory check failed for ${this.code}: ${err.message}`);
      }
    }

    // scenario bookkeeping (scenarios end on their own)
    const scenarioEnded = scenarioManager.tick(this);

    // 7. derive shipment status from live conditions
    const outOfRange = this.lastReading.status === READING_STATUS.EXCURSION;
    const critical = outOfRange || sensorFailed;
    const delayed = overdueMs > 0 || vehicle.state === VEHICLE_STATE.DELAYED;
    this.status = critical
      ? SHIPMENT_STATUS.CRITICAL
      : delayed
        ? SHIPMENT_STATUS.DELAYED
        : SHIPMENT_STATUS.IN_TRANSIT;

    if (this.aborted) return { aborted: true };

    const patch = {
      status: this.status,
      currentLatitude: gps.latitude,
      currentLongitude: gps.longitude,
      'vehicle.vehicleId': this.vehicle.vehicleId,
      'vehicle.state': vehicle.state,
      'vehicle.speedKmph': vehicle.speedKmph,
      expectedDelivery: this.expectedDelivery,
      ...this.snapshotPatch(SIM_STATE.RUNNING),
    };
    if (reading) patch.currentTemperature = reading.temperature;
    await deps.shipmentService.applySimulationUpdate(this.shipmentId, patch);

    this._emit(SOCKET_EVENTS.SHIPMENT_UPDATE, this._shipmentPayload(vehicle, gps));

    // 8. destination reached?
    if (gps.arrived) {
      await this._complete(timestamp, gps, vehicle);
      return { completed: true, tick: this.tickCount, status: this.status, newAlerts, scenarioEnded };
    }

    return { completed: false, tick: this.tickCount, status: this.status, newAlerts, scenarioEnded };
  }

  async _complete(timestamp, gps) {
    const { deps } = this;
    this.status = SHIPMENT_STATUS.DELIVERED;
    this.vehicle.state = VEHICLE_STATE.STOPPED;
    this.vehicle.speedKmph = 0;

    const updated = await deps.shipmentService.markDelivered(this.shipmentId, {
      actualDelivery: timestamp,
      latitude: gps.latitude,
      longitude: gps.longitude,
      snapshot: this.snapshotPatch(SIM_STATE.COMPLETED),
    });

    try {
      // `updated` is null when the shipment was cancelled while the last tick was in flight: no stock is booked then
      if (updated) await deps.inventorySimulator.handleArrival(updated);
    } catch (err) {
      logger.error(`Inventory update failed for delivered shipment ${this.code}: ${err.message}`);
    }

    this._emit(SOCKET_EVENTS.SHIPMENT_UPDATE, {
      ...this._shipmentPayload({ state: VEHICLE_STATE.STOPPED, speedKmph: 0 }, gps),
      actualDelivery: timestamp,
    });
  }

  _shipmentPayload(vehicle, gps) {
    return {
      shipmentId: this.shipmentId,
      shipmentCode: this.code,
      status: this.status,
      currentTemperature: this.lastReading.temperature,
      currentLatitude: gps.latitude,
      currentLongitude: gps.longitude,
      progress: round(gps.progress * 100, 1),
      vehicle: { vehicleId: this.vehicle.vehicleId, state: vehicle.state, speedKmph: vehicle.speedKmph },
      expectedDelivery: this.expectedDelivery,
      scenario: this.scenario.name || SCENARIO.NORMAL,
      simTime: this.simTime,
    };
  }
}

module.exports = { ShipmentSimulator };
