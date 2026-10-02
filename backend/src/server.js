'use strict';

const http = require('http');
const config = require('./config/env');
const { connectDB, disconnectDB } = require('./config/db');
const logger = require('./utils/logger');

async function main() {
  config.assertValid();

  const app = require('./app');
  const { initSocket } = require('./sockets');
  const simulationManager = require('./simulation/simulationManager');
  const inventorySimulator = require('./simulation/inventorySimulator');
  const shipmentService = require('./services/shipmentService');

  await connectDB();

  // Make sure indexes exist before serving traffic (the partial unique index prevents duplicate active alerts).
  const mongoose = require('mongoose');
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));

  const stale = await shipmentService.markStaleSimulationsStopped();
  if (stale > 0) logger.warn(`${stale} shipment simulation(s) were left running by a previous process and were marked STOPPED`);

  const server = http.createServer(app);
  const io = initSocket(server);

  inventorySimulator.startMonitor(config.inventory.scanIntervalMinutes);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, resolve);
  });
  logger.info(`Cold-chain API listening on http://localhost:${config.port} (${config.env})`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, shutting down...`);
    const force = setTimeout(() => process.exit(1), 15000);
    if (force.unref) force.unref();
    try {
      inventorySimulator.stopMonitor();
      await simulationManager.shutdown();
      await new Promise((resolve) => io.close(resolve));
      await new Promise((resolve) => server.close(resolve));
      await disconnectDB();
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown:', err.message);
      process.exit(1);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason && reason.stack ? reason.stack : reason);
});

main().catch((err) => {
  logger.error('Failed to start server:', err.message);
  process.exit(1);
});
