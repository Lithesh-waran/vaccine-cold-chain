'use strict';

const mongoose = require('mongoose');
const { READING_SOURCE } = require('../config/constants');

const locationReadingSchema = new mongoose.Schema({
  shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment', required: true },
  latitude: { type: Number, required: true, min: -90, max: 90 },
  longitude: { type: Number, required: true, min: -180, max: 180 },
  timestamp: { type: Date, required: true, default: Date.now },
  source: { type: String, enum: Object.values(READING_SOURCE), default: READING_SOURCE.SIMULATION },
});

locationReadingSchema.index({ shipmentId: 1, timestamp: 1 });

module.exports = mongoose.models.LocationReading || mongoose.model('LocationReading', locationReadingSchema);
