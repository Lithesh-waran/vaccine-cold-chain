'use strict';

const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema(
  {
    warehouseId: { type: String, required: true, trim: true, uppercase: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
    quantity: { type: Number, required: true, min: 0, default: 0 },
    minimumStock: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

inventorySchema.index({ warehouseId: 1, batchId: 1 }, { unique: true });

module.exports = mongoose.models.Inventory || mongoose.model('Inventory', inventorySchema);
