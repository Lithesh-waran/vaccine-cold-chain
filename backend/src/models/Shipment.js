'use strict';

const mongoose = require('mongoose');
const { SHIPMENT_STATUS, VEHICLE_STATE, SIM_STATE, SCENARIO } = require('../config/constants');

const { Schema } = mongoose;

const pointSchema = new Schema(
  {
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
  },
  { _id: false }
);

const locationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    warehouseId: { type: String, trim: true, uppercase: true },
  },
  { _id: false }
);

const shipmentSchema = new Schema(
  {
    shipmentId: { type: String, required: true, unique: true, trim: true, uppercase: true },
    batchId: { type: Schema.Types.ObjectId, ref: 'Batch', required: true, index: true },
    quantity: { type: Number, required: true, min: 1 },
    source: { type: locationSchema, required: true },
    destination: { type: locationSchema, required: true },
    route: { type: [pointSchema], default: [] },
    status: {
      type: String,
      enum: Object.values(SHIPMENT_STATUS),
      default: SHIPMENT_STATUS.PREPARING,
      index: true,
    },
    startTime: { type: Date },
    expectedDelivery: { type: Date },
    // true when expectedDelivery was computed by the system (and may be recomputed after a reset)
    autoExpectedDelivery: { type: Boolean, default: false },
    actualDelivery: { type: Date },
    temperatureMin: { type: Number, required: true },
    temperatureMax: { type: Number, required: true },
    currentTemperature: { type: Number, default: null },
    currentLatitude: { type: Number, default: null },
    currentLongitude: { type: Number, default: null },
    routeToleranceKm: { type: Number, default: 2, min: 0.1 },

    vehicle: {
      vehicleId: { type: String, default: null },
      state: { type: String, enum: Object.values(VEHICLE_STATE), default: VEHICLE_STATE.STOPPED },
      speedKmph: { type: Number, default: 0 },
    },

    // Snapshot of the in-memory simulation so status survives restarts and simulations can be resumed.
    simulation: {
      state: { type: String, enum: Object.values(SIM_STATE), default: SIM_STATE.IDLE },
      scenario: { type: String, enum: Object.values(SCENARIO), default: SCENARIO.NORMAL },
      progressKm: { type: Number, default: 0 },
      totalKm: { type: Number, default: 0 },
      progress: { type: Number, default: 0 },
      simTime: { type: Date },
      timeScale: { type: Number },
      tickIntervalMs: { type: Number },
      ticks: { type: Number, default: 0 },
      updatedAt: { type: Date },
    },

    // Which inventory movements were applied (so reset / delete can revert them exactly once).
    inventoryMovements: {
      departed: { type: Boolean, default: false },
      arrived: { type: Boolean, default: false },
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

shipmentSchema.index({ status: 1, createdAt: -1 });

shipmentSchema.pre('validate', function checkLimits() {
  if (
    this.temperatureMin !== undefined &&
    this.temperatureMax !== undefined &&
    this.temperatureMin >= this.temperatureMax
  ) {
    this.invalidate('temperatureMax', 'temperatureMax must be greater than temperatureMin');
  }
});

module.exports = mongoose.models.Shipment || mongoose.model('Shipment', shipmentSchema);
