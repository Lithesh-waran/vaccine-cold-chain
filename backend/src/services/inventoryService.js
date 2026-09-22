'use strict';

const Inventory = require('../models/Inventory');
const Batch = require('../models/Batch');
const Shipment = require('../models/Shipment');
const config = require('../config/env');
const { ALERT_TYPE, ALERT_SEVERITY, BATCH_STATUS, SOCKET_EVENTS } = require('../config/constants');
const AppError = require('../utils/AppError');
const { parsePagination, buildMeta, parseSort } = require('../utils/pagination');
const alertService = require('./alertService');
const socketEmitter = require('../sockets/socketEmitter');
const logger = require('../utils/logger');

const DAY_MS = 24 * 60 * 60 * 1000;
const SORT_FIELDS = ['quantity', 'minimumStock', 'warehouseId', 'updatedAt', 'createdAt'];
const BATCH_POPULATE = {
  path: 'batchId',
  select: 'batchNumber vaccineId expiryDate manufacturingDate status warehouseId',
  populate: { path: 'vaccineId', select: 'name manufacturer type storageMin storageMax' },
};

const normWarehouse = (id) => String(id || '').trim().toUpperCase();

function emitInventory(row, batch, reason) {
  socketEmitter.emitToDashboard(SOCKET_EVENTS.INVENTORY_UPDATE, {
    inventoryId: String(row._id),
    warehouseId: row.warehouseId,
    batchId: String(row.batchId),
    batchNumber: batch ? batch.batchNumber : undefined,
    quantity: row.quantity,
    minimumStock: row.minimumStock,
    reason,
    updatedAt: row.updatedAt || new Date(),
  });
}

// ------------------------------------------------------------------ alert rules

/** LOW_STOCK (quantity <= minimumStock) and EXPIRY_RISK for one stock row; clears alerts whose condition is gone. */
async function evaluateRow(row, batch, now = new Date()) {
  const key = { batchId: row.batchId, warehouseId: row.warehouseId };
  const outcome = { lowStock: false, expiryRisk: false };

  if (row.quantity <= row.minimumStock) {
    outcome.lowStock = true;
    await alertService.raiseAlert({
      ...key,
      type: ALERT_TYPE.LOW_STOCK,
      severity: ALERT_SEVERITY.WARNING,
      message: `Low stock of batch ${batch.batchNumber} in ${row.warehouseId}: ${row.quantity} units (minimum ${row.minimumStock})`,
      value: row.quantity,
      threshold: row.minimumStock,
      timestamp: now,
    });
  } else {
    await alertService.resolveCondition({ ...key, type: ALERT_TYPE.LOW_STOCK });
  }

  const msLeft = new Date(batch.expiryDate).getTime() - now.getTime();
  const warningDays = config.alerts.expiryWarningDays;
  if (row.quantity > 0 && msLeft <= warningDays * DAY_MS) {
    outcome.expiryRisk = true;
    const daysLeft = Math.ceil(msLeft / DAY_MS);
    await alertService.raiseAlert({
      ...key,
      type: ALERT_TYPE.EXPIRY_RISK,
      severity: ALERT_SEVERITY.WARNING,
      message:
        daysLeft <= 0
          ? `Batch ${batch.batchNumber} in ${row.warehouseId} has expired (${row.quantity} units still in stock)`
          : `Batch ${batch.batchNumber} in ${row.warehouseId} expires in ${daysLeft} day(s) (${row.quantity} units in stock)`,
      value: daysLeft,
      threshold: warningDays,
      timestamp: now,
    });
  } else {
    await alertService.resolveCondition({ ...key, type: ALERT_TYPE.EXPIRY_RISK });
  }
  return outcome;
}

/** Called by the simulation engine while a shipment travels: checks every stock row of the shipment's batch. */
async function evaluateShipmentInventory(shipment) {
  const batch = await Batch.findById(shipment.batchId).lean();
  if (!batch) return { rows: 0 };
  const rows = await Inventory.find({ batchId: batch._id }).lean();
  for (const row of rows) await evaluateRow(row, batch);
  return { rows: rows.length };
}

/** Periodic scan of all stock (independent of shipments). */
async function scanAll() {
  const now = new Date();
  await Batch.updateMany(
    { expiryDate: { $lte: now }, status: BATCH_STATUS.AVAILABLE },
    { $set: { status: BATCH_STATUS.EXPIRED } }
  );
  const rows = await Inventory.find().lean();
  if (!rows.length) return { rows: 0 };
  const batches = await Batch.find({ _id: { $in: [...new Set(rows.map((r) => String(r.batchId)))] } }).lean();
  const byId = new Map(batches.map((b) => [String(b._id), b]));
  for (const row of rows) {
    const batch = byId.get(String(row.batchId));
    if (batch) await evaluateRow(row, batch, now);
  }
  logger.debug(`Inventory scan finished (${rows.length} stock rows)`);
  return { rows: rows.length };
}

// ------------------------------------------------------------------ stock movements (idempotent per shipment)

async function upsertAdd(warehouseId, batchId, quantity) {
  return Inventory.findOneAndUpdate(
    { warehouseId, batchId },
    { $inc: { quantity }, $setOnInsert: { minimumStock: 0 } },
    { upsert: true, new: true }
  );
}

async function takeStock(warehouseId, batchId, quantity, { strict }) {
  const row = await Inventory.findOneAndUpdate(
    { warehouseId, batchId, quantity: { $gte: quantity } },
    { $inc: { quantity: -quantity } },
    { new: true }
  );
  if (row || strict) return row;
  // lenient mode (reverting): take whatever is left, never below zero
  return Inventory.findOneAndUpdate({ warehouseId, batchId }, { $set: { quantity: 0 } }, { new: true });
}

/** Deducts the shipped quantity from the source warehouse. Throws 409 when there is not enough stock. */
async function applyDeparture(shipment) {
  const batch = await Batch.findById(shipment.batchId).lean();
  if (!batch) throw AppError.notFound('Batch of this shipment no longer exists');

  const flagged = await Shipment.findOneAndUpdate(
    { _id: shipment._id, 'inventoryMovements.departed': { $ne: true } },
    { $set: { 'inventoryMovements.departed': true } }
  );
  if (!flagged) return null; // already booked

  const warehouseId = normWarehouse(shipment.source.warehouseId || batch.warehouseId);
  const row = await takeStock(warehouseId, batch._id, shipment.quantity, { strict: true });
  if (!row) {
    await Shipment.updateOne({ _id: shipment._id }, { $set: { 'inventoryMovements.departed': false } });
    throw AppError.conflict(
      `Insufficient stock of batch ${batch.batchNumber} in warehouse ${warehouseId} to dispatch ${shipment.quantity} units`
    );
  }
  emitInventory(row, batch, 'DEPARTURE');
  await evaluateRow(row, batch);
  return row;
}

/** Returns the shipped quantity to the source warehouse (cancel / reset of a shipment that already departed). */
async function revertDeparture(shipment) {
  const flagged = await Shipment.findOneAndUpdate(
    { _id: shipment._id, 'inventoryMovements.departed': true },
    { $set: { 'inventoryMovements.departed': false } }
  );
  if (!flagged) return null;
  const batch = await Batch.findById(shipment.batchId).lean();
  if (!batch) return null;
  const row = await upsertAdd(normWarehouse(shipment.source.warehouseId || batch.warehouseId), batch._id, shipment.quantity);
  emitInventory(row, batch, 'DEPARTURE_REVERTED');
  await evaluateRow(row, batch);
  return row;
}

/** Books the delivered quantity into the destination warehouse (exactly once per shipment). */
async function applyArrival(shipment) {
  const flagged = await Shipment.findOneAndUpdate(
    { _id: shipment._id, 'inventoryMovements.arrived': { $ne: true } },
    { $set: { 'inventoryMovements.arrived': true } }
  );
  if (!flagged) return null;
  const batch = await Batch.findById(shipment.batchId).lean();
  if (!batch) return null;
  const row = await upsertAdd(normWarehouse(shipment.destination.warehouseId), batch._id, shipment.quantity);
  emitInventory(row, batch, 'ARRIVAL');
  await evaluateRow(row, batch);
  return row;
}

async function revertArrival(shipment) {
  const flagged = await Shipment.findOneAndUpdate(
    { _id: shipment._id, 'inventoryMovements.arrived': true },
    { $set: { 'inventoryMovements.arrived': false } }
  );
  if (!flagged) return null;
  const batch = await Batch.findById(shipment.batchId).lean();
  if (!batch) return null;
  const row = await takeStock(normWarehouse(shipment.destination.warehouseId), batch._id, shipment.quantity, { strict: false });
  if (row) {
    emitInventory(row, batch, 'ARRIVAL_REVERTED');
    await evaluateRow(row, batch);
  }
  return row;
}

// ------------------------------------------------------------------ batch <-> stock bookkeeping

/** Creates the stock row of a new batch in its home warehouse. */
async function createStockForBatch(batch, minimumStock = 0) {
  const row = await Inventory.findOneAndUpdate(
    { warehouseId: normWarehouse(batch.warehouseId), batchId: batch._id },
    { $setOnInsert: { quantity: batch.quantity, minimumStock } },
    { upsert: true, new: true }
  );
  emitInventory(row, batch, 'BATCH_CREATED');
  await evaluateRow(row, batch);
  return row;
}

/** Applies a quantity correction of a batch to its home warehouse stock (delta may be negative). */
async function adjustBatchStock(batch, delta) {
  if (!delta) return null;
  const warehouseId = normWarehouse(batch.warehouseId);
  let row;
  if (delta > 0) {
    row = await upsertAdd(warehouseId, batch._id, delta);
  } else {
    row = await takeStock(warehouseId, batch._id, -delta, { strict: true });
    if (!row) throw AppError.conflict('Cannot reduce the batch quantity below the stock still available in its warehouse');
  }
  emitInventory(row, batch, 'BATCH_ADJUSTED');
  await evaluateRow(row, batch);
  return row;
}

async function hasStock(batchId) {
  return Inventory.exists({ batchId, quantity: { $gt: 0 } });
}

async function deleteForBatch(batchId) {
  await Inventory.deleteMany({ batchId });
}

// ------------------------------------------------------------------ queries

function decorate(row) {
  const batch = row.batchId && row.batchId.expiryDate ? row.batchId : null;
  return {
    ...row,
    lowStock: row.quantity <= row.minimumStock,
    daysToExpiry: batch ? Math.ceil((new Date(batch.expiryDate).getTime() - Date.now()) / DAY_MS) : null,
  };
}

async function list(query = {}, base = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { ...base };
  if (query.batchId) filter.batchId = query.batchId;
  if (query.warehouseId && !base.warehouseId) filter.warehouseId = normWarehouse(query.warehouseId);
  const sort = parseSort(query.sort, SORT_FIELDS, { warehouseId: 1, updatedAt: -1 });

  const [rows, total] = await Promise.all([
    Inventory.find(filter).sort(sort).skip(skip).limit(limit).populate(BATCH_POPULATE).select('-__v').lean(),
    Inventory.countDocuments(filter),
  ]);
  return { items: rows.map(decorate), meta: buildMeta(page, limit, total) };
}

async function listByWarehouse(warehouseId, query = {}) {
  const wh = normWarehouse(warehouseId);
  const result = await list(query, { warehouseId: wh });
  if (result.meta.total === 0) throw AppError.notFound(`No inventory found for warehouse ${wh}`);
  const [totals] = await Inventory.aggregate([
    { $match: { warehouseId: wh } },
    { $group: { _id: null, totalUnits: { $sum: '$quantity' }, batches: { $sum: 1 } } },
  ]);
  return { ...result, warehouse: { warehouseId: wh, totalUnits: totals ? totals.totalUnits : 0, batches: totals ? totals.batches : 0 } };
}

async function listLowStock() {
  const rows = await Inventory.find({ $expr: { $lte: ['$quantity', '$minimumStock'] } })
    .sort({ warehouseId: 1, quantity: 1 })
    .populate(BATCH_POPULATE)
    .select('-__v')
    .lean();
  return rows.map(decorate);
}

/** Stock of batches that expire within `days` (or have already expired). */
async function listExpiring(query = {}) {
  let days = Number(query.days);
  if (!Number.isFinite(days) || days < 0) days = config.alerts.expiryWarningDays;
  days = Math.min(days, 3650);

  const limitDate = new Date(Date.now() + days * DAY_MS);
  const batchFilter = { expiryDate: { $lte: limitDate } };
  if (query.includeExpired === 'false') batchFilter.expiryDate.$gt = new Date();
  const batchIds = await Batch.distinct('_id', batchFilter);

  const rows = await Inventory.find({ batchId: { $in: batchIds }, quantity: { $gt: 0 } })
    .populate(BATCH_POPULATE)
    .select('-__v')
    .lean();
  const items = rows.map(decorate).sort((a, b) => a.daysToExpiry - b.daysToExpiry);
  return { items, days };
}

async function updateSettings(id, { minimumStock }) {
  const row = await Inventory.findByIdAndUpdate(id, { $set: { minimumStock } }, { new: true, runValidators: true });
  if (!row) throw AppError.notFound('Inventory record not found');
  const batch = await Batch.findById(row.batchId).lean();
  if (batch) {
    emitInventory(row, batch, 'SETTINGS_UPDATED');
    await evaluateRow(row.toObject(), batch);
  }
  return row;
}

async function summary() {
  const [totals] = await Inventory.aggregate([
    { $group: { _id: null, totalUnits: { $sum: '$quantity' }, rows: { $sum: 1 } } },
  ]);
  const lowStock = await Inventory.countDocuments({ $expr: { $lte: ['$quantity', '$minimumStock'] } });
  return { totalUnits: totals ? totals.totalUnits : 0, stockRecords: totals ? totals.rows : 0, lowStockRecords: lowStock };
}

module.exports = {
  evaluateRow,
  evaluateShipmentInventory,
  scanAll,
  applyDeparture,
  revertDeparture,
  applyArrival,
  revertArrival,
  createStockForBatch,
  adjustBatchStock,
  hasStock,
  deleteForBatch,
  list,
  listByWarehouse,
  listLowStock,
  listExpiring,
  updateSettings,
  summary,
};
