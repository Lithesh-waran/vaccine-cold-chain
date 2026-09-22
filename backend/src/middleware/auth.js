'use strict';

const authService = require('../services/authService');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

function extractToken(req) {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!/^Bearer$/i.test(scheme) || !token) throw AppError.unauthorized('Authorization header must be "Bearer <token>"');
  return token;
}

/** Requires a valid JWT; exposes the user as req.user. */
const authenticate = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw AppError.unauthorized();
  req.user = await authService.getUserFromToken(token);
  next();
});

/** Attaches req.user when a token is supplied (an invalid token is still rejected), otherwise continues anonymously. */
const optionalAuthenticate = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (token) req.user = await authService.getUserFromToken(token);
  next();
});

/** Role-based access control: authorize('ADMIN', 'OPERATOR'). Must run after authenticate. */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return next(AppError.unauthorized());
  if (!roles.includes(req.user.role)) {
    return next(AppError.forbidden(`Role ${req.user.role} is not allowed to perform this action`));
  }
  return next();
};

module.exports = { authenticate, optionalAuthenticate, authorize };
