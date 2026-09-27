'use strict';

const simulationManager = require('../simulation/simulationManager');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');

const start = asyncHandler(async (req, res) => ok(res, await simulationManager.start(req.params.id, req.body)));

const pause = asyncHandler(async (req, res) => ok(res, await simulationManager.pause(req.params.id)));

const resume = asyncHandler(async (req, res) => ok(res, await simulationManager.resume(req.params.id)));

const stop = asyncHandler(async (req, res) => ok(res, await simulationManager.stop(req.params.id)));

const reset = asyncHandler(async (req, res) => ok(res, await simulationManager.reset(req.params.id)));

const status = asyncHandler(async (req, res) => ok(res, await simulationManager.status(req.params.id)));

const scenario = asyncHandler(async (req, res) =>
  ok(res, await simulationManager.applyScenario(req.params.id, req.body.scenario, req.body.options || {}))
);

const listScenarios = asyncHandler(async (req, res) => ok(res, simulationManager.scenarios()));

const listActive = asyncHandler(async (req, res) => {
  const running = simulationManager.listActive();
  return ok(res, running, { count: running.length });
});

module.exports = { start, pause, resume, stop, reset, status, scenario, listScenarios, listActive };
