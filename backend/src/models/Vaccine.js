'use strict';

const mongoose = require('mongoose');

const vaccineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    manufacturer: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, required: true, trim: true, maxlength: 60 },
    storageMin: { type: Number, required: true },
    storageMax: { type: Number, required: true },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
  },
  { timestamps: true }
);

vaccineSchema.index({ name: 1, manufacturer: 1 }, { unique: true });

vaccineSchema.pre('validate', function checkRange() {
  if (this.storageMin !== undefined && this.storageMax !== undefined && this.storageMin >= this.storageMax) {
    this.invalidate('storageMax', 'storageMax must be greater than storageMin');
  }
});

module.exports = mongoose.models.Vaccine || mongoose.model('Vaccine', vaccineSchema);
