'use strict';

const crypto = require('crypto');
const Shipment = require('../models/Shipment');
const Batch = require('../models/Batch');
const Inventory = require('../models/Inventory');
const config = require('../config/env');
const {
  SHIPMENT_STATUS,
  ACTIVE_SHIPMENT_STATUSES,
  VEHICLE_STATE,
  SIM_STATE,
  SCENARIO,
  BATCH_STATUS,
} = require('../config/constants');
const AppError = require('../utils/AppError');
const escapeRegex = require('../utils/escapeRegex');
const { generateRoute, routeLengthKm } = require('../utils/geo');
const { parsePagination, buildMeta, parseSort } = require('../utils/pagination');
const inventoryService = require('./inventoryService');
const readingService = require('./readingService');
const alertService = require('./alertService');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const SORT_FIELDS = ['shipmentId', 'status', 'startTime', 'expectedDelivery', 'actualDelivery', 'quantity', 'createdAt'];
const POPULATE_BATCH = {
  path: 'batchId',
  select: 'batchNumber vaccineId quantity expiryDate status warehouseId',
  populate: { path: 'vaccineId', select: 'name manufacturer type storageMin storageMax' },
};

const normWarehouse = (id) => (id ? String(id).trim().toUpperCase() : undefined);

function generateCode() {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `SHP-${ymd}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function parseDate(value, name) {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw AppError.badRequest(`${name} must be a valid ISO 8601 date`);
  return d;
}

// ------------------------------------------------------------------ lookup

/** Finds a shipment by database id or by its human readable code (e.g. SHP-20260924-AB12). Returns a lean document. */
async function getByRef(ref) {
  const value = String(ref || '').trim();
  const shipment = OBJECT_ID.test(value)
    ? await Shipment.findById(value).lean()
    : await Shipment.findOne({ shipmentId: value.toUpperCase() }).lean();
  if (!shipment) throw AppError.notFound('Shipment not found');
  return shipment;
}

async function getDetails(ref) {
  const base = await getByRef(ref);
  const shipment = await Shipment.findById(base._id)
    .populate(POPULATE_BATCH)
    .populate('createdBy', 'name email role')
    .select('-__v')
    .lean();
  const alertCounts = await alertService.countsForShipment(base._id);
  return { ...shipment, alertCounts };
}

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.status) {
    const statuses = String(query.status)
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => Object.values(SHIPMENT_STATUS).includes(s));
    if (statuses.length) filter.status = { $in: statuses };
  }
  if (query.batchId) filter.batchId = query.batchId;
  if (query.source) filter['source.warehouseId'] = normWarehouse(query.source);
  if (query.destination) filter['destination.warehouseId'] = normWarehouse(query.destination);
  if (query.search) filter.shipmentId = new RegExp(escapeRegex(String(query.search).trim()), 'i');
  const sort = parseSort(query.sort, SORT_FIELDS, { createdAt: -1 });

  const [items, total] = await Promise.all([
    Shipment.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate(POPULATE_BATCH)
      .select('-__v -route')
      .lean(),
    Shipment.countDocuments(filter),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
}

// ------------------------------------------------------------------ CRUD

async function assertStockAvailable(warehouseId, batchId, quantity) {
  const stock = await Inventory.findOne({ warehouseId, batchId }).lean();
  if (!stock || stock.quantity < quantity) {
    throw AppError.conflict(
      `Insufficient stock in warehouse ${warehouseId}: ${stock ? stock.quantity : 0} units available, ${quantity} requested`
    );
  }
}

function buildLocation(input, fallbackWarehouse) {
  return {
    name: input.name,
    latitude: input.latitude,
    longitude: input.longitude,
    warehouseId: normWarehouse(input.warehouseId) || fallbackWarehouse,
  };
}

async function create(data, user) {
  const batch = await Batch.findById(data.batchId).populate('vaccineId').lean();
  if (!batch) throw AppError.badRequest('batchId does not reference an existing batch');
  if (batch.status !== BATCH_STATUS.AVAILABLE) {
    throw AppError.conflict(`Batch ${batch.batchNumber} is ${batch.status} and cannot be shipped`);
  }
  if (new Date(batch.expiryDate) <= new Date()) throw AppError.conflict(`Batch ${batch.batchNumber} has expired`);

  const source = buildLocation(data.source, normWarehouse(batch.warehouseId));
  const destination = buildLocation(data.destination);
  if (!destination.warehouseId) throw AppError.badRequest('destination.warehouseId is required to book the delivery into inventory');
  if (source.warehouseId === destination.warehouseId) {
    throw AppError.badRequest('source and destination warehouses must be different');
  }
  await assertStockAvailable(source.warehouseId, batch._id, data.quantity);

  const temperatureMin = data.temperatureMin !== undefined ? data.temperatureMin : batch.vaccineId.storageMin;
  const temperatureMax = data.temperatureMax !== undefined ? data.temperatureMax : batch.vaccineId.storageMax;
  if (temperatureMin >= temperatureMax) throw AppError.badRequest('temperatureMax must be greater than temperatureMin');

  const route = data.route && data.route.length >= 2 ? data.route : generateRoute(source, destination);

  let shipmentId = data.shipmentId || generateCode();
  if (data.shipmentId && (await Shipment.exists({ shipmentId }))) {
    throw AppError.conflict(`Shipment ${shipmentId} already exists`);
  }
  shipmentId = String(shipmentId).toUpperCase();

  const shipment = await Shipment.create({
    shipmentId,
    batchId: batch._id,
    quantity: data.quantity,
    source,
    destination,
    route,
    startTime: data.startTime,
    expectedDelivery: data.expectedDelivery,
    autoExpectedDelivery: !data.expectedDelivery,
    temperatureMin,
    temperatureMax,
    routeToleranceKm: data.routeToleranceKm !== undefined ? data.routeToleranceKm : config.simulation.routeToleranceKm,
    vehicle: { vehicleId: `VEH-${shipmentId.replace(/[^A-Z0-9]/g, '').slice(-6)}`, state: VEHICLE_STATE.STOPPED, speedKmph: 0 },
    createdBy: user._id,
  });
  return getDetails(shipment._id);
}

/**
 * Updates a shipment. While PREPARING any planning field can change; once it departed the only allowed
 * change is cancellation (status: CANCELLED), because the running simulation works on the planned values.
 */
async function update(ref, data) {
  const shipment = await getByRef(ref);
  if (shipment.status === SHIPMENT_STATUS.DELIVERED) throw AppError.conflict('A delivered shipment cannot be modified');
  if (shipment.status === SHIPMENT_STATUS.CANCELLED) throw AppError.conflict('A cancelled shipment cannot be modified');

  if (data.status !== undefined && data.status !== SHIPMENT_STATUS.CANCELLED && data.status !== shipment.status) {
    throw AppError.badRequest('Shipment status is driven by the simulation; the only status you can set manually is CANCELLED');
  }
  if (data.status === SHIPMENT_STATUS.CANCELLED) return cancel(shipment);

  if (shipment.status !== SHIPMENT_STATUS.PREPARING) {
    throw AppError.conflict('This shipment has already departed; it can only be cancelled (status: CANCELLED) or reset');
  }

  const batch = await Batch.findById(shipment.batchId).lean();
  const patch = {};
  if (data.quantity !== undefined) patch.quantity = data.quantity;
  if (data.source) patch.source = buildLocation(data.source, normWarehouse(batch && batch.warehouseId));
  if (data.destination) patch.destination = buildLocation(data.destination);
  if (data.temperatureMin !== undefined) patch.temperatureMin = data.temperatureMin;
  if (data.temperatureMax !== undefined) patch.temperatureMax = data.temperatureMax;
  if (data.routeToleranceKm !== undefined) patch.routeToleranceKm = data.routeToleranceKm;
  if (data.startTime !== undefined) patch.startTime = data.startTime;
  if (data.expectedDelivery !== undefined) {
    patch.expectedDelivery = data.expectedDelivery;
    patch.autoExpectedDelivery = false;
  }

  const source = patch.source || shipment.source;
  const destination = patch.destination || shipment.destination;
  if (!destination.warehouseId) throw AppError.badRequest('destination.warehouseId is required');
  if (source.warehouseId === destination.warehouseId) throw AppError.badRequest('source and destination warehouses must be different');

  const min = patch.temperatureMin !== undefined ? patch.temperatureMin : shipment.temperatureMin;
  const max = patch.temperatureMax !== undefined ? patch.temperatureMax : shipment.temperatureMax;
  if (min >= max) throw AppError.badRequest('temperatureMax must be greater than temperatureMin');

  if (data.route && data.route.length >= 2) patch.route = data.route;
  else if (patch.source || patch.destination) patch.route = generateRoute(source, destination);

  if (patch.quantity !== undefined || patch.source) {
    await assertStockAvailable(source.warehouseId, shipment.batchId, patch.quantity !== undefined ? patch.quantity : shipment.quantity);
  }

  await Shipment.updateOne({ _id: shipment._id }, { $set: patch }, { runValidators: true });
  return getDetails(shipment._id);
}

/** Cancels a shipment and returns any stock that already left the source warehouse. */
async function cancel(shipment) {
  const updated = await Shipment.findOneAndUpdate(
    { _id: shipment._id, status: { $nin: [SHIPMENT_STATUS.DELIVERED, SHIPMENT_STATUS.CANCELLED] } },
    {
      $set: {
        status: SHIPMENT_STATUS.CANCELLED,
        'vehicle.state': VEHICLE_STATE.STOPPED,
        'vehicle.speedKmph': 0,
        'simulation.state': SIM_STATE.STOPPED,
        'simulation.updatedAt': new Date(),
      },
    },
    { new: true }
  ).lean();
  if (!updated) throw AppError.conflict('Shipment can no longer be cancelled');
  await inventoryService.revertDeparture(updated);
  return getDetails(updated._id);
}

async function remove(ref) {
  const shipment = await getByRef(ref);
  if (ACTIVE_SHIPMENT_STATUSES.includes(shipment.status)) {
    throw AppError.conflict('Shipment is in transit; cancel it before deleting');
  }
  await Promise.all([readingService.deleteForShipment(shipment._id), alertService.deleteForShipment(shipment._id)]);
  await Shipment.deleteOne({ _id: shipment._id });
  return { id: String(shipment._id), shipmentId: shipment.shipmentId };
}

// ------------------------------------------------------------------ simulation support

/** PREPARING -> IN_TRANSIT: deducts stock from the source warehouse and stamps departure data. */
async function beginTransit(shipment) {
  await inventoryService.applyDeparture(shipment);

  try {
    const now = new Date();
    const patch = {
      status: SHIPMENT_STATUS.IN_TRANSIT,
      startTime: now,
      'vehicle.state': VEHICLE_STATE.STOPPED,
      'vehicle.speedKmph': 0,
    };

    let route = shipment.route;
    if (!route || route.length < 2) {
      route = generateRoute(shipment.source, shipment.destination);
      patch.route = route;
    }
    patch.currentLatitude = route[0].latitude;
    patch.currentLongitude = route[0].longitude;

    // Expected delivery: keep the planned duration if the user supplied planned start + ETA, else derive from route length.
    let expected = shipment.expectedDelivery ? new Date(shipment.expectedDelivery) : null;
    if (expected && shipment.startTime && !shipment.autoExpectedDelivery) {
      expected = new Date(expected.getTime() + (now.getTime() - new Date(shipment.startTime).getTime()));
    }
    if (!expected || expected <= now) {
      const minutes = (routeLengthKm(route) / config.simulation.cruiseSpeedKmph) * 60 * config.simulation.etaBufferFactor;
      expected = new Date(now.getTime() + minutes * 60000);
      patch.autoExpectedDelivery = true;
    }
    patch.expectedDelivery = expected;

    const updated = await Shipment.findOneAndUpdate(
      { _id: shipment._id, status: SHIPMENT_STATUS.PREPARING },
      { $set: patch },
      { new: true }
    ).lean();
    if (!updated) throw AppError.conflict('Shipment has already been started');
    return updated;
  } catch (err) {
    await inventoryService.revertDeparture(shipment).catch(() => {});
    throw err;
  }
}

/** Persists one simulation tick. Status changes are ignored once the shipment left the active states (e.g. cancelled). */
async function applySimulationUpdate(id, patch) {
  const filter = { _id: id };
  if (Object.prototype.hasOwnProperty.call(patch, 'status')) filter.status = { $in: ACTIVE_SHIPMENT_STATUSES };
  await Shipment.updateOne(filter, { $set: patch });
}

async function markDelivered(id, { actualDelivery, latitude, longitude, snapshot = {} }) {
  return Shipment.findOneAndUpdate(
    { _id: id, status: { $in: ACTIVE_SHIPMENT_STATUSES } },
    {
      $set: {
        ...snapshot,
        status: SHIPMENT_STATUS.DELIVERED,
        actualDelivery,
        currentLatitude: latitude,
        currentLongitude: longitude,
        'vehicle.state': VEHICLE_STATE.STOPPED,
        'vehicle.speedKmph': 0,
      },
    },
    { new: true }
  ).lean();
}

/** Back to PREPARING: discards readings and alerts and reverts the stock movements of this shipment. */
async function resetShipment(shipment) {
  await inventoryService.revertArrival(shipment);
  await inventoryService.revertDeparture(shipment);
  await Promise.all([readingService.deleteForShipment(shipment._id), alertService.deleteForShipment(shipment._id)]);

  const unset = {
    startTime: '',
    actualDelivery: '',
    'simulation.simTime': '',
    'simulation.updatedAt': '',
    'simulation.timeScale': '',
    'simulation.tickIntervalMs': '',
  };
  if (shipment.autoExpectedDelivery) unset.expectedDelivery = '';

  await Shipment.updateOne(
    { _id: shipment._id },
    {
      $set: {
        status: SHIPMENT_STATUS.PREPARING,
        currentTemperature: null,
        currentLatitude: null,
        currentLongitude: null,
        'vehicle.state': VEHICLE_STATE.STOPPED,
        'vehicle.speedKmph': 0,
        'simulation.state': SIM_STATE.IDLE,
        'simulation.scenario': SCENARIO.NORMAL,
        'simulation.progressKm': 0,
        'simulation.totalKm': 0,
        'simulation.progress': 0,
        'simulation.ticks': 0,
        'inventoryMovements.departed': false,
        'inventoryMovements.arrived': false,
      },
      $unset: unset,
    }
  );
  return Shipment.findById(shipment._id).lean();
}

/** After a crash / hard restart no simulation is really running: fix the stale snapshots. */
async function markStaleSimulationsStopped() {
  const res = await Shipment.updateMany(
    { 'simulation.state': { $in: [SIM_STATE.RUNNING, SIM_STATE.PAUSED] } },
    { $set: { 'simulation.state': SIM_STATE.STOPPED, 'simulation.updatedAt': new Date() } }
  );
  return res.modifiedCount || 0;
}

// ------------------------------------------------------------------ readings

async function getTemperatureData(ref, query = {}) {
  const shipment = await getByRef(ref);
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 500;
  limit = Math.min(limit, 5000);
  const range = { from: parseDate(query.from, 'from'), to: parseDate(query.to, 'to'), limit };

  const [readings, summary] = await Promise.all([
    readingService.listTemperature(shipment._id, range),
    readingService.temperatureSummary(shipment._id),
  ]);
  return {
    shipmentId: String(shipment._id),
    shipmentCode: shipment.shipmentId,
    limits: { min: shipment.temperatureMin, max: shipment.temperatureMax },
    currentTemperature: shipment.currentTemperature,
    summary,
    returned: readings.length,
    readings,
  };
}

async function getLocationData(ref, query = {}) {
  const shipment = await getByRef(ref);
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 500;
  limit = Math.min(limit, 5000);

  const track = await readingService.listLocation(shipment._id, {
    from: parseDate(query.from, 'from'),
    to: parseDate(query.to, 'to'),
    limit,
  });
  return {
    shipmentId: String(shipment._id),
    shipmentCode: shipment.shipmentId,
    status: shipment.status,
    source: shipment.source,
    destination: shipment.destination,
    current: { latitude: shipment.currentLatitude, longitude: shipment.currentLongitude },
    progress: shipment.simulation ? shipment.simulation.progress : 0,
    vehicle: shipment.vehicle,
    plannedRoute: shipment.route,
    returned: track.length,
    track,
  };
}

module.exports = {
  getByRef,
  getDetails,
  list,
  create,
  update,
  cancel,
  remove,
  beginTransit,
  applySimulationUpdate,
  markDelivered,
  resetShipment,
  markStaleSimulationsStopped,
  getTemperatureData,
  getLocationData,
};
