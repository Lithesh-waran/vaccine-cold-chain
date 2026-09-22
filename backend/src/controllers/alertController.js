'use strict';

const alertService = require('../services/alertService');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');

const list = asyncHandler(async (req, res) => {
  const { items, meta } = await alertService.list(req.query);
  return ok(res, items, { meta });
});

const active = asyncHandler(async (req, res) => {
  const { items, meta } = await alertService.listActive(req.query);
  return ok(res, items, { meta });
});

const resolve = asyncHandler(async (req, res) => ok(res, await alertService.resolveAlert(req.params.id, req.user)));

module.exports = { list, active, resolve };
