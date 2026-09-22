'use strict';

const Shipment = require('../models/Shipment');
const Alert = require('../models/Alert');
const Vaccine = require('../models/Vaccine');
const Batch = require('../models/Batch');
const TemperatureReading = require('../models/TemperatureReading');
const { SHIPMENT_STATUS, ACTIVE_SHIPMENT_STATUSES, ALERT_SEVERITY, READING_STATUS } = require('../config/constants');
const { computeScore, DISCLAIMER } = require('../utils/compliance');
const inventoryService = require('./inventoryService');
const simulationManager = require('../simulation/simulationManager');

async function getSummary() {
  const [statusRows, alertSeverityRows, alertTypeRows, vaccines, batches, inventory, expiring, readingRows, activeShipments, recentAlerts] =
    await Promise.all([
      Shipment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Alert.aggregate([{ $match: { resolved: false } }, { $group: { _id: '$severity', count: { $sum: 1 } } }]),
      Alert.aggregate([{ $match: { resolved: false } }, { $group: { _id: '$type', count: { $sum: 1 } } }]),
      Vaccine.countDocuments(),
      Batch.countDocuments(),
      inventoryService.summary(),
      inventoryService.listExpiring({}),
      TemperatureReading.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            normal: { $sum: { $cond: [{ $eq: ['$status', READING_STATUS.NORMAL] }, 1, 0] } },
          },
        },
      ]),
      Shipment.find({ status: { $in: ACTIVE_SHIPMENT_STATUSES } })
        .sort({ updatedAt: -1 })
        .limit(20)
        .select('shipmentId status currentTemperature currentLatitude currentLongitude temperatureMin temperatureMax destination.name source.name simulation.progress vehicle expectedDelivery')
        .lean(),
      Alert.find({ resolved: false })
        .sort({ severityRank: 1, timestamp: -1 })
        .limit(5)
        .populate('shipmentId', 'shipmentId')
        .select('-__v -dedupeKey')
        .lean(),
    ]);

  const byStatus = Object.fromEntries(Object.values(SHIPMENT_STATUS).map((s) => [s, 0]));
  statusRows.forEach((r) => {
    byStatus[r._id] = r.count;
  });
  const bySeverity = Object.fromEntries(Object.values(ALERT_SEVERITY).map((s) => [s, 0]));
  alertSeverityRows.forEach((r) => {
    bySeverity[r._id] = r.count;
  });
  const byType = Object.fromEntries(alertTypeRows.map((r) => [r._id, r.count]));
  const totalShipments = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const readings = readingRows[0] || { total: 0, normal: 0 };
  const running = simulationManager.listActive();

  return {
    generatedAt: new Date(),
    shipments: {
      total: totalShipments,
      byStatus,
      active: ACTIVE_SHIPMENT_STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
      delivered: byStatus[SHIPMENT_STATUS.DELIVERED],
    },
    activeShipments,
    alerts: {
      active: Object.values(bySeverity).reduce((a, b) => a + b, 0),
      bySeverity,
      byType,
      recent: recentAlerts,
    },
    inventory: { ...inventory, expiringSoonRecords: expiring.items.length },
    catalog: { vaccines, batches },
    compliance: {
      score: computeScore(readings.normal, readings.total),
      totalReadings: readings.total,
      normalReadings: readings.normal,
      disclaimer: DISCLAIMER,
    },
    simulations: {
      active: running.length,
      running: running.map((s) => ({
        shipmentId: s.shipmentId,
        shipmentCode: s.shipmentCode,
        state: s.state,
        scenario: s.scenario.name,
        progress: s.progress,
        timeScale: s.timeScale,
      })),
    },
  };
}

module.exports = { getSummary };
