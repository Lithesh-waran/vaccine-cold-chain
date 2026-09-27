'use strict';

const { READING_STATUS } = require('../config/constants');
const { round } = require('./random');

/** Summary statistics for an array of temperature readings (any order). */
function summarizeReadings(readings) {
  const total = readings.length;
  if (!total) {
    return { total: 0, normal: 0, excursions: 0, min: null, max: null, average: null };
  }
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let normal = 0;
  for (const r of readings) {
    if (r.temperature < min) min = r.temperature;
    if (r.temperature > max) max = r.temperature;
    sum += r.temperature;
    if (r.status === READING_STATUS.NORMAL) normal += 1;
  }
  return {
    total,
    normal,
    excursions: total - normal,
    min: round(min, 2),
    max: round(max, 2),
    average: round(sum / total, 2),
  };
}

/**
 * Groups consecutive EXCURSION readings (ascending by timestamp) into events.
 * Each event holds start/end, number of readings, direction and peak deviation from the limit.
 */
function findExcursionEvents(readings, limits) {
  const events = [];
  let current = null;

  for (const r of readings) {
    if (r.status === READING_STATUS.EXCURSION) {
      const high = r.temperature > limits.max;
      const deviation = high ? r.temperature - limits.max : limits.min - r.temperature;
      if (!current) {
        current = {
          start: r.timestamp,
          end: r.timestamp,
          readings: 0,
          direction: high ? 'HIGH' : 'LOW',
          peakTemperature: r.temperature,
          peakDeviation: 0,
        };
      }
      current.end = r.timestamp;
      current.readings += 1;
      if (deviation > current.peakDeviation) {
        current.peakDeviation = round(deviation, 2);
        current.peakTemperature = r.temperature;
      }
    } else if (current) {
      events.push(current);
      current = null;
    }
  }
  if (current) events.push(current);

  return events.map((e) => ({
    ...e,
    durationMinutes: Math.round((new Date(e.end) - new Date(e.start)) / 60000),
  }));
}

/** Evenly thins an array to at most maxPoints entries (always keeps the last element). */
function downsample(items, maxPoints) {
  if (items.length <= maxPoints) return items;
  const step = Math.ceil(items.length / maxPoints);
  const out = [];
  for (let i = 0; i < items.length; i += step) out.push(items[i]);
  if (out[out.length - 1] !== items[items.length - 1]) out.push(items[items.length - 1]);
  return out;
}

module.exports = { summarizeReadings, findExcursionEvents, downsample };
