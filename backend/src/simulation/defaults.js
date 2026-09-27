'use strict';

/** Engine defaults. Values from the environment are injected by simulationManager. */
module.exports = Object.freeze({
  tickIntervalMs: 3000,
  timeScale: 60,
  cruiseSpeedKmph: 50,
  etaBufferFactor: 1.25,
  sensorTimeoutMs: 10000,
  routeToleranceKm: 2,
  inventoryCheckEveryTicks: 5,
  randomStopChance: 0.01,
});
