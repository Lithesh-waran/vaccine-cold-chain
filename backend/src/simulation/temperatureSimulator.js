'use strict';

const { gaussian, clamp, round } = require('../utils/random');

/**
 * Generates a smooth virtual temperature signal for one shipment.
 *
 * Model: a mean-reverting process (the load slowly returns to the middle of the allowed range) with
 * small Gaussian noise plus a slow sinusoidal drift (door openings / ambient changes). Excursions are
 * injected by moving the target gradually (ramp -> hold -> recover), never by jumping to a random value.
 * The sensor can also be "failed", in which case no reading is reported while the true temperature keeps evolving.
 */
class TemperatureSimulator {
  constructor({
    min,
    max,
    rng = Math.random,
    initial,
    reversion = 0.3,
    driftPeriodTicks = 40,
  }) {
    if (!(Number.isFinite(min) && Number.isFinite(max) && min < max)) {
      throw new Error('TemperatureSimulator requires min < max');
    }
    this.min = min;
    this.max = max;
    this.rng = rng;
    this.range = max - min;
    this.mid = (min + max) / 2;

    // Wider ranges (e.g. ultra-cold storage) get proportionally larger noise / steps.
    const scale = Math.max(1, this.range / 6);
    this.noiseSd = 0.08 * scale;
    this.maxStep = 1.2 * scale;
    this.driftAmplitude = Math.min(0.6 * scale, this.range * 0.2);
    this.driftPeriodTicks = driftPeriodTicks;
    this.reversion = reversion;

    this.tickCount = 0;
    this.current = Number.isFinite(initial) ? initial : this.mid + gaussian(rng) * this.noiseSd;
    this.sensorFailed = false;
    this.excursion = null;
  }

  /**
   * Starts a gradual excursion beyond a limit.
   * @param {'HIGH'|'LOW'} direction
   * @param {number} [overshoot] degrees beyond the limit the target reaches
   */
  startExcursion({ direction = 'HIGH', overshoot, rampTicks = 6, holdTicks = 8, recoverTicks = 8 } = {}) {
    const beyond = Number.isFinite(overshoot) ? overshoot : Math.max(2, this.range * 0.4);
    const half = this.range / 2;
    const peakOffset = direction === 'LOW' ? -(half + beyond) : half + beyond;
    this.excursion = {
      direction,
      peakOffset,
      phase: 'RAMP',
      tickInPhase: 0,
      rampTicks: Math.max(1, rampTicks),
      holdTicks: Math.max(0, holdTicks),
      recoverTicks: Math.max(1, recoverTicks),
    };
  }

  /** Lets an active excursion recover smoothly (the temperature is never snapped back). */
  endExcursion() {
    if (!this.excursion || this.excursion.phase === 'RECOVER') return;
    const current = this.excursion;
    // Continue recovering from wherever the offset currently is.
    current.peakOffset = this._excursionOffset();
    current.phase = 'RECOVER';
    current.tickInPhase = 0;
  }

  isExcursionActive() {
    return this.excursion !== null;
  }

  failSensor() {
    this.sensorFailed = true;
  }

  restoreSensor() {
    this.sensorFailed = false;
  }

  _excursionOffset() {
    const e = this.excursion;
    if (!e) return 0;
    if (e.phase === 'RAMP') return e.peakOffset * Math.min(1, e.tickInPhase / e.rampTicks);
    if (e.phase === 'HOLD') return e.peakOffset;
    return e.peakOffset * Math.max(0, 1 - e.tickInPhase / e.recoverTicks);
  }

  _advanceExcursion() {
    const e = this.excursion;
    if (!e) return;
    e.tickInPhase += 1;
    if (e.phase === 'RAMP' && e.tickInPhase >= e.rampTicks) {
      e.phase = 'HOLD';
      e.tickInPhase = 0;
    } else if (e.phase === 'HOLD' && e.tickInPhase >= e.holdTicks) {
      e.phase = 'RECOVER';
      e.tickInPhase = 0;
    } else if (e.phase === 'RECOVER' && e.tickInPhase >= e.recoverTicks) {
      this.excursion = null;
    }
  }

  /**
   * Advances the model by one tick.
   * @returns {{ temperature: number|null, trueTemperature: number }} temperature is null while the sensor is failed
   */
  next() {
    this.tickCount += 1;
    this._advanceExcursion();

    const drift =
      this.driftAmplitude * Math.sin((2 * Math.PI * this.tickCount) / this.driftPeriodTicks);
    const target = this.mid + drift + this._excursionOffset();

    let delta = this.reversion * (target - this.current) + gaussian(this.rng) * this.noiseSd;
    delta = clamp(delta, -this.maxStep, this.maxStep);
    this.current += delta;

    const trueTemperature = round(this.current, 2);
    return {
      temperature: this.sensorFailed ? null : trueTemperature,
      trueTemperature,
    };
  }

  isWithinLimits(temperature) {
    return temperature >= this.min && temperature <= this.max;
  }
}

module.exports = { TemperatureSimulator };
