'use strict';

const {
  cumulativeDistances,
  pointAtDistance,
  destinationPoint,
  distanceToPolylineKm,
} = require('../utils/geo');
const { round } = require('../utils/random');

/**
 * Moves a virtual GPS device progressively along a route (polyline of waypoints).
 * Optionally drifts sideways off the route to simulate a route deviation.
 */
class GpsSimulator {
  constructor(route, { rng = Math.random, startDistanceKm = 0, deviationStepKm = 0.6, noiseKm = 0.002 } = {}) {
    if (!Array.isArray(route) || route.length < 2) {
      throw new Error('GpsSimulator requires a route with at least 2 waypoints');
    }
    this.route = route.map((p) => ({ latitude: Number(p.latitude), longitude: Number(p.longitude) }));
    this.cumulative = cumulativeDistances(this.route);
    this.totalKm = this.cumulative[this.cumulative.length - 1];
    this.distanceKm = Math.min(Math.max(0, startDistanceKm), this.totalKm);
    this.rng = rng;
    this.deviationStepKm = deviationStepKm;
    this.noiseKm = noiseKm;
    this.deviationKm = 0;
    this.targetDeviationKm = 0;
  }

  /** Ask the device to drift up to `km` away from the route (gradually). */
  setDeviation(km) {
    this.targetDeviationKm = Math.max(0, km);
  }

  /** Steer back onto the planned route (gradually). */
  clearDeviation() {
    this.targetDeviationKm = 0;
  }

  hasArrived() {
    return this.distanceKm >= this.totalKm - 1e-9;
  }

  /** Travel `km` further along the route and return the new state. */
  advance(km) {
    this.distanceKm = Math.min(this.totalKm, this.distanceKm + Math.max(0, km));

    if (this.deviationKm < this.targetDeviationKm) {
      this.deviationKm = Math.min(this.targetDeviationKm, this.deviationKm + this.deviationStepKm);
    } else if (this.deviationKm > this.targetDeviationKm) {
      this.deviationKm = Math.max(this.targetDeviationKm, this.deviationKm - this.deviationStepKm);
    }
    if (this.hasArrived()) {
      // Deliveries always end exactly at the destination.
      this.deviationKm = 0;
      this.targetDeviationKm = 0;
    }
    return this.getState();
  }

  getState() {
    const onRoute = pointAtDistance(this.route, this.cumulative, this.distanceKm);
    const arrived = this.hasArrived();
    let position = { latitude: onRoute.latitude, longitude: onRoute.longitude };

    if (!arrived) {
      if (this.deviationKm > 0.0001) {
        position = destinationPoint(position, (onRoute.bearing + 90) % 360, this.deviationKm);
      }
      // ~metre-level GPS jitter
      const jitter = () => (this.rng() - 0.5) * 2 * (this.noiseKm / 111);
      position = { latitude: position.latitude + jitter(), longitude: position.longitude + jitter() };
    }

    return {
      latitude: round(position.latitude, 6),
      longitude: round(position.longitude, 6),
      bearing: round(onRoute.bearing, 1),
      distanceKm: round(this.distanceKm, 3),
      remainingKm: round(this.totalKm - this.distanceKm, 3),
      totalKm: round(this.totalKm, 3),
      progress: this.totalKm > 0 ? this.distanceKm / this.totalKm : 1,
      deviationKm: round(this.deviationKm, 3),
      distanceFromRouteKm: round(distanceToPolylineKm(position, this.route), 3),
      arrived,
    };
  }
}

module.exports = { GpsSimulator };
