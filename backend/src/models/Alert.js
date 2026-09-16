'use strict';

const mongoose = require('mongoose');
const { ALERT_TYPE, ALERT_SEVERITY } = require('../config/constants');

const alertSchema = new mongoose.Schema({
  // Shipment alerts carry shipmentId; inventory alerts (LOW_STOCK / EXPIRY_RISK) carry batchId + warehouseId.
  shipmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shipment', default: null, index: true },
  batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', default: null },
  warehouseId: { type: String, default: null },
  type: { type: String, enum: Object.values(ALERT_TYPE), required: true },
  severity: { type: String, enum: Object.values(ALERT_SEVERITY), required: true },
  // 0 = CRITICAL, 1 = WARNING, 2 = INFO (lets the API sort by severity in the database)
  severityRank: { type: Number, default: 1 },
  message: { type: String, required: true },
  value: { type: Number, default: null },
  threshold: { type: Number, default: null },
  timestamp: { type: Date, required: true, default: Date.now },
  resolved: { type: Boolean, default: false },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Identifies "the same condition" so that only one active alert can exist per condition.
  dedupeKey: { type: String, required: true },
});

alertSchema.index({ resolved: 1, timestamp: -1 });
alertSchema.index({ shipmentId: 1, type: 1 });
alertSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { resolved: false }, name: 'unique_active_alert_per_condition' }
);

module.exports = mongoose.models.Alert || mongoose.model('Alert', alertSchema);
