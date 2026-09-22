'use strict';

const Batch = require('../models/Batch');
const Vaccine = require('../models/Vaccine');
const Shipment = require('../models/Shipment');
const Alert = require('../models/Alert');
const { BATCH_STATUS } = require('../config/constants');
const AppError = require('../utils/AppError');
const escapeRegex = require('../utils/escapeRegex');
const { parsePagination, buildMeta, parseSort } = require('../utils/pagination');
const inventoryService = require('./inventoryService');

const SORT_FIELDS = ['batchNumber', 'expiryDate', 'manufacturingDate', 'quantity', 'status', 'createdAt'];
const DAY_MS = 24 * 60 * 60 * 1000;

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.vaccineId) filter.vaccineId = query.vaccineId;
  if (query.warehouseId) filter.warehouseId = String(query.warehouseId).trim().toUpperCase();
  if (query.status && Object.values(BATCH_STATUS).includes(String(query.status).toUpperCase())) {
    filter.status = String(query.status).toUpperCase();
  }
  const days = Number(query.expiringInDays);
  if (Number.isFinite(days) && days >= 0) filter.expiryDate = { $lte: new Date(Date.now() + days * DAY_MS) };
  if (query.search) filter.batchNumber = new RegExp(escapeRegex(String(query.search).trim()), 'i');
  const sort = parseSort(query.sort, SORT_FIELDS, { expiryDate: 1 });

  const [items, total] = await Promise.all([
    Batch.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('vaccineId', 'name manufacturer type storageMin storageMax')
      .select('-__v')
      .lean(),
    Batch.countDocuments(filter),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
}

async function getById(id) {
  const batch = await Batch.findById(id)
    .populate('vaccineId', 'name manufacturer type storageMin storageMax description')
    .select('-__v')
    .lean();
  if (!batch) throw AppError.notFound('Batch not found');
  return batch;
}

/** Creates the batch and books its quantity as stock in the home warehouse. */
async function create({ minimumStock = 0, ...data }) {
  const vaccine = await Vaccine.exists({ _id: data.vaccineId });
  if (!vaccine) throw AppError.badRequest('vaccineId does not reference an existing vaccine');

  const batch = await Batch.create(data);
  try {
    await inventoryService.createStockForBatch(batch, minimumStock);
  } catch (err) {
    await Batch.deleteOne({ _id: batch._id });
    throw err;
  }
  return getById(batch._id);
}

async function update(id, data) {
  const batch = await Batch.findById(id);
  if (!batch) throw AppError.notFound('Batch not found');

  const previousQuantity = batch.quantity;
  batch.set(data);
  await batch.validate(); // date ordering, enums, ...

  const delta = batch.quantity - previousQuantity;
  if (delta !== 0) await inventoryService.adjustBatchStock(batch, delta);
  try {
    await batch.save();
  } catch (err) {
    if (delta !== 0) await inventoryService.adjustBatchStock({ ...batch.toObject(), quantity: previousQuantity }, -delta).catch(() => {});
    throw err;
  }
  await inventoryService.scanAll().catch(() => {}); // status / expiry changes may raise or clear alerts
  return getById(id);
}

async function remove(id) {
  const batch = await Batch.findById(id);
  if (!batch) throw AppError.notFound('Batch not found');
  const shipments = await Shipment.countDocuments({ batchId: id });
  if (shipments > 0) throw AppError.conflict(`Batch is referenced by ${shipments} shipment(s) and cannot be deleted`);

  await inventoryService.deleteForBatch(id);
  await Alert.deleteMany({ batchId: id });
  await batch.deleteOne();
  return { id };
}

module.exports = { list, getById, create, update, remove };
