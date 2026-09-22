'use strict';

const shipmentService = require('../services/shipmentService');
const alertService = require('../services/alertService');
const complianceService = require('../services/complianceService');
const reportService = require('../services/reportService');
const simulationManager = require('../simulation/simulationManager');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');
const { SHIPMENT_STATUS } = require('../config/constants');

const list = asyncHandler(async (req, res) => {
  const { items, meta } = await shipmentService.list(req.query);
  return ok(res, items, { meta });
});

const getOne = asyncHandler(async (req, res) => ok(res, await shipmentService.getDetails(req.params.id)));

const create = asyncHandler(async (req, res) => created(res, await shipmentService.create(req.body, req.user)));

const update = asyncHandler(async (req, res) => {
  // a running simulation must be halted before the shipment is cancelled
  if (req.body.status === SHIPMENT_STATUS.CANCELLED) {
    const shipment = await shipmentService.getByRef(req.params.id);
    await simulationManager.stopIfActive(shipment._id, 'shipment-cancelled');
  }
  return ok(res, await shipmentService.update(req.params.id, req.body));
});

const remove = asyncHandler(async (req, res) => {
  const result = await shipmentService.remove(req.params.id);
  return ok(res, { deleted: true, ...result });
});

/** POST /api/shipments/:id/start - departs the shipment and starts its simulation. */
const start = asyncHandler(async (req, res) => {
  const result = await simulationManager.start(req.params.id, req.body);
  return ok(res, result);
});

const temperature = asyncHandler(async (req, res) =>
  ok(res, await shipmentService.getTemperatureData(req.params.id, req.query))
);

const location = asyncHandler(async (req, res) => ok(res, await shipmentService.getLocationData(req.params.id, req.query)));

const alerts = asyncHandler(async (req, res) => {
  const shipment = await shipmentService.getByRef(req.params.id);
  const { items, meta } = await alertService.listForShipment(shipment._id, req.query);
  return ok(res, items, { meta });
});

const compliance = asyncHandler(async (req, res) => ok(res, await complianceService.getCompliance(req.params.id)));

const report = asyncHandler(async (req, res) => {
  const { buffer, filename } = await reportService.generateShipmentReport(req.params.id);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': String(buffer.length),
    'Cache-Control': 'no-store',
  });
  return res.status(200).end(buffer);
});

module.exports = { list, getOne, create, update, remove, start, temperature, location, alerts, compliance, report };
