'use strict';

const { clamp, round } = require('./random');

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

function haversineKm(a, b) {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b in degrees [0, 360). */
function bearingDeg(a, b) {
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached by travelling `km` from `point` along `bearing` (degrees). Negative km goes backwards. */
function destinationPoint(point, bearing, km) {
  const delta = km / EARTH_RADIUS_KM;
  const theta = toRad(bearing);
  const lat1 = toRad(point.latitude);
  const lon1 = toRad(point.longitude);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(delta) + Math.cos(lat1) * Math.sin(delta) * Math.cos(theta)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
      Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { latitude: toDeg(lat2), longitude: ((toDeg(lon2) + 540) % 360) - 180 };
}

function cumulativeDistances(route) {
  const cumulative = [0];
  for (let i = 1; i < route.length; i += 1) {
    cumulative.push(cumulative[i - 1] + haversineKm(route[i - 1], route[i]));
  }
  return cumulative;
}

function routeLengthKm(route) {
  if (!route || route.length < 2) return 0;
  const cumulative = cumulativeDistances(route);
  return cumulative[cumulative.length - 1];
}

/** Position `distanceKm` along the polyline (clamped to its ends). */
function pointAtDistance(route, cumulative, distanceKm) {
  const total = cumulative[cumulative.length - 1];
  const d = clamp(distanceKm, 0, total);

  if (d >= total) {
    const last = route[route.length - 1];
    const prev = route[route.length - 2];
    return {
      latitude: last.latitude,
      longitude: last.longitude,
      bearing: bearingDeg(prev, last),
      segmentIndex: route.length - 2,
    };
  }

  let i = 0;
  while (i < cumulative.length - 2 && cumulative[i + 1] <= d) i += 1;
  const a = route[i];
  const b = route[i + 1];
  const segmentLength = cumulative[i + 1] - cumulative[i];
  const t = segmentLength > 0 ? (d - cumulative[i]) / segmentLength : 0;
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
    bearing: bearingDeg(a, b),
    segmentIndex: i,
  };
}

/** Shortest distance (km) from a point to the route polyline (local equirectangular projection). */
function distanceToPolylineKm(point, route) {
  const kLat = 110.574;
  const kLon = 111.32 * Math.cos(toRad(point.latitude));
  let best = Infinity;

  for (let i = 0; i < route.length - 1; i += 1) {
    const ax = (route[i].longitude - point.longitude) * kLon;
    const ay = (route[i].latitude - point.latitude) * kLat;
    const bx = (route[i + 1].longitude - point.longitude) * kLon;
    const by = (route[i + 1].latitude - point.latitude) * kLat;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : clamp(-(ax * dx + ay * dy) / lengthSquared, 0, 1);
    const distance = Math.hypot(ax + t * dx, ay + t * dy);
    if (distance < best) best = distance;
  }
  return best;
}

/**
 * Builds a gently curving route between two coordinates. Used when a shipment is
 * created without explicit waypoints.
 */
function generateRoute(source, destination, { points = 8, curvature = 0.03, rng = Math.random } = {}) {
  const total = haversineKm(source, destination);
  const bearing = bearingDeg(source, destination);
  const side = rng() < 0.5 ? 1 : -1;
  const amplitude = total * curvature * (0.6 + 0.4 * rng());

  const route = [{ latitude: source.latitude, longitude: source.longitude }];
  for (let i = 1; i <= points; i += 1) {
    const t = i / (points + 1);
    const base = {
      latitude: source.latitude + (destination.latitude - source.latitude) * t,
      longitude: source.longitude + (destination.longitude - source.longitude) * t,
    };
    const offset =
      side * amplitude * Math.sin(Math.PI * t) + amplitude * 0.2 * Math.sin(3 * Math.PI * t);
    const p = destinationPoint(base, (bearing + 90) % 360, offset);
    route.push({ latitude: round(p.latitude, 6), longitude: round(p.longitude, 6) });
  }
  route.push({ latitude: destination.latitude, longitude: destination.longitude });
  return route;
}

module.exports = {
  haversineKm,
  bearingDeg,
  destinationPoint,
  cumulativeDistances,
  routeLengthKm,
  pointAtDistance,
  distanceToPolylineKm,
  generateRoute,
};
