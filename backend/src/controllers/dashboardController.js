'use strict';

const dashboardService = require('../services/dashboardService');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');

const summary = asyncHandler(async (req, res) => ok(res, await dashboardService.getSummary()));

module.exports = { summary };
