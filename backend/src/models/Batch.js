'use strict';

const mongoose = require('mongoose');
const { BATCH_STATUS } = require('../config/constants');

const batchSchema = new mongoose.Schema(
  {
    batchNumber: { type: String, required: true, unique: true, trim: true, uppercase: true },
    vaccineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vaccine', required: true, index: true },
    quantity: { type: Number, required: true, min: 0 },
    manufacturingDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true, index: true },
    warehouseId: { type: String, required: true, trim: true, uppercase: true, index: true },
    status: { type: String, enum: Object.values(BATCH_STATUS), default: BATCH_STATUS.AVAILABLE },
  },
  { timestamps: true }
);

batchSchema.pre('validate', function checkDates() {
  if (this.manufacturingDate && this.expiryDate && this.expiryDate <= this.manufacturingDate) {
    this.invalidate('expiryDate', 'expiryDate must be after manufacturingDate');
  }
});

module.exports = mongoose.models.Batch || mongoose.model('Batch', batchSchema);
