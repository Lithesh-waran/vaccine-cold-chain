'use strict';

const inventoryService = require('../services/inventoryService');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');

const list = asyncHandler(async (req, res) => {
  const { items, meta } = await inventoryService.list(req.query);
  return ok(res, items, { meta });
});

const byWarehouse = asyncHandler(async (req, res) => {
  const { items, meta, warehouse } = await inventoryService.listByWarehouse(req.params.warehouseId, req.query);
  return ok(res, items, { meta, warehouse });
});

const lowStock = asyncHandler(async (req, res) => {
  const items = await inventoryService.listLowStock();
  return ok(res, items, { count: items.length });
});

const expiring = asyncHandler(async (req, res) => {
  const { items, days } = await inventoryService.listExpiring(req.query);
  return ok(res, items, { count: items.length, days });
});

const updateSettings = asyncHandler(async (req, res) => ok(res, await inventoryService.updateSettings(req.params.id, req.body)));

module.exports = { list, byWarehouse, lowStock, expiring, updateSettings };
