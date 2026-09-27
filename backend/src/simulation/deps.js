'use strict';

/**
 * Default collaborators of the simulation engine. They are required lazily so the pure simulation
 * classes can be unit-tested without a database, and so tests can inject fakes.
 */
function createDefaultDeps() {
  return {
    readingService: require('../services/readingService'),
    alertService: require('../services/alertService'),
    shipmentService: require('../services/shipmentService'),
    inventorySimulator: require('./inventorySimulator'),
    emitter: require('../sockets/socketEmitter'),
  };
}

module.exports = { createDefaultDeps };
