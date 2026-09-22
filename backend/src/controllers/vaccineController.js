'use strict';

const vaccineService = require('../services/vaccineService');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');

const list = asyncHandler(async (req, res) => {
  const { items, meta } = await vaccineService.list(req.query);
  return ok(res, items, { meta });
});

const getOne = asyncHandler(async (req, res) => ok(res, await vaccineService.getById(req.params.id)));

const create = asyncHandler(async (req, res) => created(res, await vaccineService.create(req.body)));

const update = asyncHandler(async (req, res) => ok(res, await vaccineService.update(req.params.id, req.body)));

const remove = asyncHandler(async (req, res) => {
  await vaccineService.remove(req.params.id);
  return ok(res, { deleted: true, id: req.params.id });
});

module.exports = { list, getOne, create, update, remove };
