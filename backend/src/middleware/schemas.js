'use strict';

const { v } = require('./validate');
const { ROLES, BATCH_STATUS, SHIPMENT_STATUS, SCENARIO } = require('../config/constants');

const latitude = (opts = {}) => v.number({ min: -90, max: 90, ...opts });
const longitude = (opts = {}) => v.number({ min: -180, max: 180, ...opts });

const place = v.object(
  {
    name: v.string({ required: true, min: 2, max: 120 }),
    latitude: latitude({ required: true }),
    longitude: longitude({ required: true }),
    warehouseId: v.string({ uppercase: true, max: 40 }),
  },
  { required: true }
);

const routePoint = v.object({ latitude: latitude({ required: true }), longitude: longitude({ required: true }) });

const auth = {
  register: {
    name: v.string({ required: true, min: 2, max: 100 }),
    email: v.email({ required: true }),
    // bcrypt only uses the first 72 bytes
    password: v.string({ required: true, min: 8, max: 72, trim: false }),
    role: v.oneOf(Object.values(ROLES), { upper: true }),
  },
  login: {
    email: v.email({ required: true }),
    password: v.string({ required: true, max: 72, trim: false }),
  },
};

const vaccine = {
  name: v.string({ required: true, max: 120 }),
  manufacturer: v.string({ required: true, max: 120 }),
  type: v.string({ required: true, max: 60 }),
  storageMin: v.number({ required: true }),
  storageMax: v.number({ required: true }),
  description: v.string({ max: 1000 }),
};

const batchBase = {
  batchNumber: v.string({ required: true, uppercase: true, max: 60, pattern: /^[A-Z0-9][A-Z0-9._-]*$/, patternMessage: 'may only contain letters, digits, ".", "_" and "-"' }),
  quantity: v.integer({ required: true, min: 0 }),
  manufacturingDate: v.date({ required: true }),
  expiryDate: v.date({ required: true }),
  status: v.oneOf(Object.values(BATCH_STATUS), { upper: true }),
};

const batchCreate = {
  ...batchBase,
  vaccineId: v.objectId({ required: true }),
  warehouseId: v.string({ required: true, uppercase: true, max: 40 }),
  // initial reorder threshold of the stock record created together with the batch
  minimumStock: v.integer({ min: 0 }),
};

// vaccineId / warehouseId are fixed once a batch exists (stock movements reference them)
const batchUpdate = { ...batchBase };

const shipmentBase = {
  quantity: v.integer({ required: true, min: 1 }),
  source: place,
  destination: place,
  route: v.array(routePoint, { minItems: 2, maxItems: 1000 }),
  startTime: v.date(),
  expectedDelivery: v.date(),
  temperatureMin: v.number(),
  temperatureMax: v.number(),
  routeToleranceKm: v.number({ min: 0.1, max: 500 }),
};

const shipmentCreate = {
  ...shipmentBase,
  shipmentId: v.string({ uppercase: true, max: 40, pattern: /^[A-Z0-9][A-Z0-9_-]{2,39}$/, patternMessage: 'must be 3-40 characters: letters, digits, "-" or "_"' }),
  batchId: v.objectId({ required: true }),
};

const shipmentUpdate = {
  ...shipmentBase,
  status: v.oneOf(Object.values(SHIPMENT_STATUS), { upper: true }),
};

const inventoryUpdate = { minimumStock: v.integer({ required: true, min: 0 }) };

const simulationStart = {
  scenario: v.oneOf(Object.values(SCENARIO), { upper: true }),
  scenarioOptions: v.any(),
  timeScale: v.number({ gt: 0, max: 100000 }),
  tickIntervalMs: v.integer({ min: 100, max: 600000 }),
};

const simulationScenario = {
  scenario: v.oneOf(Object.values(SCENARIO), { upper: true, required: true }),
  options: v.any(),
};

module.exports = {
  auth,
  vaccine,
  batchCreate,
  batchUpdate,
  shipmentCreate,
  shipmentUpdate,
  inventoryUpdate,
  simulationStart,
  simulationScenario,
};
