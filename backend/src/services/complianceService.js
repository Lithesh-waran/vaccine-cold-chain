'use strict';

const TemperatureReading = require('../models/TemperatureReading');
const { ALERT_TYPE } = require('../config/constants');
const { computeScore, DISCLAIMER } = require('../utils/compliance');
const { summarizeReadings, findExcursionEvents } = require('../utils/temperatureStats');
const shipmentService = require('./shipmentService');
const alertService = require('./alertService');

/**
 * Application-level compliance figures of a shipment (NOT an official regulatory certification):
 *   score = normal readings / total readings x 100
 */
async function computeForShipment(shipment) {
  const readings = await TemperatureReading.find({ shipmentId: shipment._id })
    .sort({ timestamp: 1 })
    .select('temperature status timestamp')
    .lean();
  const summary = summarizeReadings(readings);
  const events = findExcursionEvents(readings, { min: shipment.temperatureMin, max: shipment.temperatureMax });
  const alertCounts = await alertService.countsForShipment(shipment._id);

  return {
    compliance: {
      shipmentId: String(shipment._id),
      shipmentCode: shipment.shipmentId,
      score: computeScore(summary.normal, summary.total),
      totalReadings: summary.total,
      normalReadings: summary.normal,
      excursionReadings: summary.excursions,
      excursionCount: events.length,
      delayCount: alertCounts[ALERT_TYPE.SHIPMENT_DELAY] || 0,
      routeDeviationCount: alertCounts[ALERT_TYPE.ROUTE_DEVIATION] || 0,
      sensorFailureCount: alertCounts[ALERT_TYPE.SENSOR_FAILURE] || 0,
      limits: { min: shipment.temperatureMin, max: shipment.temperatureMax },
      generatedAt: new Date(),
      disclaimer: DISCLAIMER,
    },
    summary,
    events,
  };
}

async function getCompliance(ref) {
  const shipment = await shipmentService.getByRef(ref);
  const { compliance } = await computeForShipment(shipment);
  return compliance;
}

module.exports = { computeForShipment, getCompliance };
