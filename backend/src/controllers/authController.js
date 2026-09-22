'use strict';

const authService = require('../services/authService');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created } = require('../utils/response');

const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, req.user || null);
  return created(res, result);
});

const login = asyncHandler(async (req, res) => ok(res, await authService.login(req.body)));

const me = asyncHandler(async (req, res) => ok(res, { user: req.user.toJSON() }));

module.exports = { register, login, me };
