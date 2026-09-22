'use strict';

const config = require('../config/env');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

function notFound(req, res, next) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  let status = 500;
  let message = 'Internal server error';
  let details;

  if (err instanceof AppError) {
    status = err.statusCode;
    message = err.message;
    details = err.details;
  } else if (err.name === 'ValidationError' && err.errors) {
    status = 400;
    message = 'Validation failed';
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid value for "${err.path}"`;
  } else if (err.code === 11000) {
    status = 409;
    const fields = Object.keys(err.keyValue || {});
    message = fields.length ? `Duplicate value for: ${fields.join(', ')}` : 'Duplicate value';
  } else if (err.name === 'TokenExpiredError') {
    status = 401;
    message = 'Token has expired, please log in again';
  } else if (err.name === 'JsonWebTokenError') {
    status = 401;
    message = 'Invalid authentication token';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON in request body';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body is too large';
  } else if (Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode < 500) {
    status = err.statusCode;
    message = err.message;
  }

  if (status >= 500) {
    logger.error(`${req.method} ${req.originalUrl} -> ${status}:`, err.stack || err.message);
    if (config.isProduction) message = 'Internal server error';
    else message = err.message || message;
  }

  const body = { success: false, message };
  if (details !== undefined) body.details = details;
  if (!config.isProduction && status >= 500) body.stack = err.stack;
  return res.status(status).json(body);
}

module.exports = { notFound, errorHandler };
