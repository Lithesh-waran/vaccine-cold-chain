'use strict';

const mongoose = require('mongoose');
const TemperatureReading = require('../models/TemperatureReading');
const LocationReading = require('../models/LocationReading');
const { READING_STATUS } = require('../config/constants');
const { round } = require('../utils/random');

const asId = (id) => new mongoose.Types.ObjectId(String(id));

async function saveTemperatureReading(data) {
  return TemperatureReading.create(data);
}

async function saveLocationReading(data) {
  return LocationReading.create(data);
}

function rangeFilter(shipmentId, { from, to } = {}) {
  const filter = { shipmentId: asId(shipmentId) };
  if (from || to) {
    filter.timestamp = {};
    if (from) filter.timestamp.$gte = from;
    if (to) filter.timestamp.$lte = to;
  }
  return filter;
}

/** Most recent `limit` readings (returned in ascending time order). */
async function listTemperature(shipmentId, { from, to, limit = 500 } = {}) {
  const rows = await TemperatureReading.find(rangeFilter(shipmentId, { from, to }))
    .sort({ timestamp: -1 })
    .limit(limit)
    .select('-__v')
    .lean();
  return rows.reverse();
}

async function listLocation(shipmentId, { from, to, limit = 500 } = {}) {
  const rows = await LocationReading.find(rangeFilter(shipmentId, { from, to }))
    .sort({ timestamp: -1 })
    .limit(limit)
    .select('-__v')
    .lean();
  return rows.reverse();
}

/** All-readings summary computed in the database. */
async function temperatureSummary(shipmentId) {
  const [row] = await TemperatureReading.aggregate([
    { $match: { shipmentId: asId(shipmentId) } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        normal: { $sum: { $cond: [{ $eq: ['$status', READING_STATUS.NORMAL] }, 1, 0] } },
        min: { $min: '$temperature' },
        max: { $max: '$temperature' },
        average: { $avg: '$temperature' },
        first: { $min: '$timestamp' },
        last: { $max: '$timestamp' },
      },
    },
  ]);
  if (!row) return { total: 0, normal: 0, excursions: 0, min: null, max: null, average: null, first: null, last: null };
  return {
    total: row.total,
    normal: row.normal,
    excursions: row.total - row.normal,
    min: round(row.min, 2),
    max: round(row.max, 2),
    average: round(row.average, 2),
    first: row.first,
    last: row.last,
  };
}

async function latestTemperature(shipmentId) {
  return TemperatureReading.findOne({ shipmentId: asId(shipmentId) }).sort({ timestamp: -1 }).lean();
}

async function latestLocation(shipmentId) {
  return LocationReading.findOne({ shipmentId: asId(shipmentId) }).sort({ timestamp: -1 }).lean();
}

async function deleteForShipment(shipmentId) {
  const filter = { shipmentId: asId(shipmentId) };
  await Promise.all([TemperatureReading.deleteMany(filter), LocationReading.deleteMany(filter)]);
}

module.exports = {
  saveTemperatureReading,
  saveLocationReading,
  listTemperature,
  listLocation,
  temperatureSummary,
  latestTemperature,
  latestLocation,
  deleteForShipment,
};
