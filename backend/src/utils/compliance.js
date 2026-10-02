'use strict';

const { round } = require('./random');

const DISCLAIMER =
  'Application-level compliance score (normal temperature readings / total temperature readings x 100). ' +
  'It is NOT an official regulatory certification.';

/** normal / total * 100, rounded to 2 decimals. Returns null when there are no readings. */
function computeScore(normalReadings, totalReadings) {
  if (!totalReadings) return null;
  return round((normalReadings / totalReadings) * 100, 2);
}

module.exports = { computeScore, DISCLAIMER };
