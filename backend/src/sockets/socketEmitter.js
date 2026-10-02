'use strict';

const { SOCKET_EVENTS, DASHBOARD_ROOM, shipmentRoom } = require('../config/constants');
const logger = require('../utils/logger');

/**
 * Thin facade over the Socket.IO server. Business logic and the simulation engine only talk to this module,
 * so they keep working (as no-ops) when no Socket.IO server is attached (seed script, tests).
 *
 * Rooms:
 *  - shipment:<id>  every event of one shipment (temperature, location, status, simulation, alerts)
 *  - dashboard      fleet-wide overview: shipment:update, alert:*, inventory:update, simulation:* (no raw readings)
 */
const DASHBOARD_EVENTS = new Set([
  SOCKET_EVENTS.SHIPMENT_UPDATE,
  SOCKET_EVENTS.ALERT_NEW,
  SOCKET_EVENTS.ALERT_RESOLVED,
  SOCKET_EVENTS.INVENTORY_UPDATE,
  SOCKET_EVENTS.SIMULATION_STARTED,
  SOCKET_EVENTS.SIMULATION_PAUSED,
  SOCKET_EVENTS.SIMULATION_STOPPED,
  SOCKET_EVENTS.SIMULATION_COMPLETED,
]);

let io = null;

function setIo(instance) {
  io = instance;
}

function getIo() {
  return io;
}

function safeEmit(rooms, event, payload) {
  if (!io) return;
  try {
    io.to(rooms).emit(event, payload);
  } catch (err) {
    logger.warn(`Socket emit failed (${event}): ${err.message}`);
  }
}

/** Emits to the shipment's room (and to the dashboard room for fleet-level events). */
function emitToShipment(shipmentId, event, payload) {
  const rooms = [shipmentRoom(String(shipmentId))];
  if (DASHBOARD_EVENTS.has(event)) rooms.push(DASHBOARD_ROOM);
  safeEmit(rooms, event, payload);
}

/** Emits to dashboard subscribers only (inventory alerts, stock changes). */
function emitToDashboard(event, payload) {
  safeEmit([DASHBOARD_ROOM], event, payload);
}

module.exports = { setIo, getIo, emitToShipment, emitToDashboard };
