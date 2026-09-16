'use strict';

const mongoose = require('mongoose');
const { READING_STATUS, READING_SOURCE } = require('../config/constants');

const temperatureReadingSchema = new mongoose.Schema({
  shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment', required: true },
  temperature: { type: Number, required: true },
  timestamp: { type: Date, required: true, default: Date.now },
  status: { type: String, enum: Object.values(READING_STATUS), required: true, default: READING_STATUS.NORMAL },
  source: { type: String, enum: Object.values(READING_SOURCE), default: READING_SOURCE.SIMULATION },
});

temperatureReadingSchema.index({ shipmentId: 1, timestamp: 1 });

module.exports =
  mongoose.models.TemperatureReading || mongoose.model('TemperatureReading', temperatureReadingSchema);
