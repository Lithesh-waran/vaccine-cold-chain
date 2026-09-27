'use strict';

const inventoryService = require('../services/inventoryService');
const logger = require('../utils/logger');

let monitorTimer = null;

/**
 * Inventory side of the simulation:
 *  - checkConditions : evaluates stock levels / expiry for the shipment's batch (called while a shipment travels)
 *  - handleArrival   : books the delivered quantity into the destination warehouse
 *  - monitor         : periodic scan of all stock (LOW_STOCK / EXPIRY_RISK) independent of any shipment
 * Departure (stock deduction at the source warehouse) happens when the shipment starts, see shipmentService.beginTransit.
 */
async function checkConditions(shipment) {
  return inventoryService.evaluateShipmentInventory(shipment);
}

async function handleArrival(shipment) {
  return inventoryService.applyArrival(shipment);
}

async function scanAll() {
  return inventoryService.scanAll();
}

function startMonitor(intervalMinutes) {
  stopMonitor();
  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;

  const run = () =>
    scanAll().catch((err) => logger.error('Inventory scan failed:', err.message));

  run(); // initial scan on boot
  monitorTimer = setInterval(run, intervalMs);
  if (monitorTimer.unref) monitorTimer.unref();
}

function stopMonitor() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
}

module.exports = { checkConditions, handleArrival, scanAll, startMonitor, stopMonitor };
