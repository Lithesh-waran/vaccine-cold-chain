'use strict';

const mongoose = require('mongoose');
const Alert = require('../models/Alert');
const { ALERT_TYPE, ALERT_SEVERITY, SOCKET_EVENTS } = require('../config/constants');
const AppError = require('../utils/AppError');
const { parsePagination, buildMeta, parseSort } = require('../utils/pagination');
const socketEmitter = require('../sockets/socketEmitter');
const logger = require('../utils/logger');

const SORT_FIELDS = ['timestamp', 'severityRank', 'type', 'resolved'];
const SEVERITY_RANK = { CRITICAL: 0, WARNING: 1, INFO: 2 };

/**
 * One "condition" = alert type + subject. While an alert for a condition is active (resolved: false)
 * no second alert can be created; a partial unique index on dedupeKey enforces this even under concurrency.
 */
function buildDedupeKey({ type, shipmentId, batchId, warehouseId }) {
  if (shipmentId) return `${type}:shipment:${shipmentId}`;
  return `${type}:stock:${warehouseId || 'na'}:${batchId || 'na'}`;
}

function toPayload(alert) {
  const plain = alert.toObject ? alert.toObject() : alert;
  return { ...plain, id: String(plain._id) };
}

function emitAlert(event, alert) {
  const payload = toPayload(alert);
  if (alert.shipmentId) socketEmitter.emitToShipment(alert.shipmentId, event, payload);
  else socketEmitter.emitToDashboard(event, payload);
}

/**
 * Creates an alert unless an active alert for the same condition already exists.
 * @returns {Promise<{created: boolean, alert: object}>}
 */
async function raiseAlert(input) {
  const { type, severity, message, value = null, threshold = null, shipmentId = null, batchId = null, warehouseId = null } = input;
  const dedupeKey = buildDedupeKey({ type, shipmentId, batchId, warehouseId });

  const existing = await Alert.findOne({ dedupeKey, resolved: false });
  if (existing) return { created: false, alert: existing };

  try {
    const alert = await Alert.create({
      shipmentId,
      batchId,
      warehouseId,
      type,
      severity,
      severityRank: SEVERITY_RANK[severity] !== undefined ? SEVERITY_RANK[severity] : 1,
      message,
      value,
      threshold,
      timestamp: input.timestamp || new Date(),
      dedupeKey,
    });
    emitAlert(SOCKET_EVENTS.ALERT_NEW, alert);
    logger.info(`Alert raised: ${type}/${severity} - ${message}`);
    return { created: true, alert };
  } catch (err) {
    if (err.code === 11000) {
      // lost a race against a concurrent raiser: the active alert exists now
      const active = await Alert.findOne({ dedupeKey, resolved: false });
      return { created: false, alert: active };
    }
    throw err;
  }
}

async function resolveAlert(id, user = null) {
  const alert = await Alert.findOneAndUpdate(
    { _id: id, resolved: false },
    { $set: { resolved: true, resolvedAt: new Date(), resolvedBy: user ? user._id : null } },
    { new: true }
  );
  if (!alert) {
    const exists = await Alert.exists({ _id: id });
    if (!exists) throw AppError.notFound('Alert not found');
    throw AppError.conflict('Alert is already resolved');
  }
  emitAlert(SOCKET_EVENTS.ALERT_RESOLVED, alert);
  return alert;
}

/** Resolves the active alert of a condition (used when the condition disappears, e.g. stock replenished). */
async function resolveCondition(input) {
  const dedupeKey = buildDedupeKey(input);
  const alert = await Alert.findOneAndUpdate(
    { dedupeKey, resolved: false },
    { $set: { resolved: true, resolvedAt: new Date() } },
    { new: true }
  );
  if (alert) emitAlert(SOCKET_EVENTS.ALERT_RESOLVED, alert);
  return alert;
}

function buildFilter(query = {}, base = {}) {
  const filter = {};
  if (query.type && Object.values(ALERT_TYPE).includes(String(query.type).toUpperCase())) {
    filter.type = String(query.type).toUpperCase();
  }
  if (query.severity && Object.values(ALERT_SEVERITY).includes(String(query.severity).toUpperCase())) {
    filter.severity = String(query.severity).toUpperCase();
  }
  if (query.shipmentId) filter.shipmentId = query.shipmentId;
  if (query.resolved === 'true' || query.resolved === 'false') filter.resolved = query.resolved === 'true';
  return Object.assign(filter, base); // the base scope (e.g. one shipment) always wins over query parameters
}

async function list(query = {}, base = {}, defaultSort = { timestamp: -1 }) {
  const { page, limit, skip } = parsePagination(query);
  const filter = buildFilter(query, base);
  const sort = parseSort(query.sort, SORT_FIELDS, defaultSort);

  const [items, total] = await Promise.all([
    Alert.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('shipmentId', 'shipmentId status')
      .select('-__v -dedupeKey')
      .lean(),
    Alert.countDocuments(filter),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
}

/** Active alerts, most severe first, then newest. */
async function listActive(query = {}) {
  return list(query, { resolved: false }, { severityRank: 1, timestamp: -1 });
}

async function listForShipment(shipmentId, query = {}) {
  return list(query, { shipmentId: new mongoose.Types.ObjectId(String(shipmentId)) });
}

async function countsForShipment(shipmentId) {
  const rows = await Alert.aggregate([
    { $match: { shipmentId: new mongoose.Types.ObjectId(String(shipmentId)) } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.count]));
}

async function deleteForShipment(shipmentId) {
  await Alert.deleteMany({ shipmentId });
}

module.exports = {
  buildDedupeKey,
  raiseAlert,
  resolveAlert,
  resolveCondition,
  list,
  listActive,
  listForShipment,
  countsForShipment,
  deleteForShipment,
};
