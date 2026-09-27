'use strict';

const { VEHICLE_STATE } = require('../config/constants');
const { gaussian, clamp } = require('../utils/random');

/**
 * Virtual vehicle with three states: MOVING, STOPPED, DELAYED.
 *  - MOVING  : cruising with smoothly varying speed
 *  - STOPPED : not moving (short random stops, or the first phase of an injected delay)
 *  - DELAYED : moving at a reduced speed (second phase of an injected delay)
 */
class VehicleSimulator {
  constructor({
    vehicleId = 'VEH-001',
    cruiseSpeedKmph = 50,
    rng = Math.random,
    randomStopChance = 0.01,
    randomStopTicks = 2,
  } = {}) {
    this.vehicleId = vehicleId;
    this.cruiseSpeedKmph = cruiseSpeedKmph;
    this.rng = rng;
    this.randomStopChance = randomStopChance;
    this.randomStopTicks = randomStopTicks;

    this.state = VEHICLE_STATE.MOVING;
    this.speedKmph = cruiseSpeedKmph;
    this.plan = null;
    this.randomStopTicksLeft = 0;
  }

  /**
   * Injects a delay: the vehicle first stops for stopSimSeconds, then crawls at
   * slowFactor * cruise speed for slowSimSeconds.
   */
  startDelay({ stopSimSeconds = 0, slowSimSeconds = 0, slowFactor = 0.4 } = {}) {
    this.plan = {
      stopLeft: Math.max(0, stopSimSeconds),
      slowLeft: Math.max(0, slowSimSeconds),
      slowFactor: clamp(slowFactor, 0.05, 0.95),
    };
  }

  clearDelay() {
    this.plan = null;
  }

  isDelayActive() {
    return this.plan !== null;
  }

  /**
   * Advances the vehicle by dtSimSeconds of simulated time.
   * @returns {{state: string, speedKmph: number}}
   */
  next(dtSimSeconds) {
    if (this.plan) {
      if (this.plan.stopLeft > 0) {
        this.plan.stopLeft -= dtSimSeconds;
        return this._set(VEHICLE_STATE.STOPPED, 0);
      }
      if (this.plan.slowLeft > 0) {
        this.plan.slowLeft -= dtSimSeconds;
        const target = this.cruiseSpeedKmph * this.plan.slowFactor;
        return this._set(VEHICLE_STATE.DELAYED, this._smooth(target));
      }
      this.plan = null; // delay finished, fall through to normal driving
    }

    if (this.randomStopTicksLeft > 0) {
      this.randomStopTicksLeft -= 1;
      return this._set(VEHICLE_STATE.STOPPED, 0);
    }
    if (this.randomStopChance > 0 && this.rng() < this.randomStopChance) {
      this.randomStopTicksLeft = this.randomStopTicks;
      return this._set(VEHICLE_STATE.STOPPED, 0);
    }

    const jitter = clamp(1 + gaussian(this.rng) * 0.04, 0.85, 1.15);
    return this._set(VEHICLE_STATE.MOVING, this._smooth(this.cruiseSpeedKmph * jitter));
  }

  _smooth(target) {
    // Exponential smoothing so speed changes gradually (also gives a realistic acceleration after a stop).
    const previous = this.speedKmph < 1 ? target * 0.5 : this.speedKmph;
    return previous * 0.6 + target * 0.4;
  }

  _set(state, speedKmph) {
    this.state = state;
    this.speedKmph = Math.round(speedKmph * 10) / 10;
    return { state: this.state, speedKmph: this.speedKmph };
  }
}

module.exports = { VehicleSimulator };
