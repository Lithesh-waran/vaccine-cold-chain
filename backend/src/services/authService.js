'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config/env');
const { ROLES } = require('../config/constants');
const User = require('../models/User');
const AppError = require('../utils/AppError');

// Used to keep the response time of "unknown e-mail" close to "wrong password" (user enumeration hardening).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 8);

function signToken(user) {
  return jwt.sign({ role: user.role }, config.jwt.secret, {
    subject: String(user._id),
    expiresIn: config.jwt.expiresIn,
  });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw AppError.unauthorized('Token has expired, please log in again');
    throw AppError.unauthorized('Invalid authentication token');
  }
}

/** Resolves a JWT to an active user document (without password). */
async function getUserFromToken(token) {
  const payload = verifyToken(token);
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw AppError.unauthorized('The account for this token no longer exists or is disabled');
  return user;
}

/**
 * Registration policy:
 *  - the very first account becomes ADMIN (bootstrap),
 *  - afterwards public sign-ups are OPERATORs,
 *  - only an authenticated ADMIN may create ADMIN / WAREHOUSE (or explicit OPERATOR) accounts.
 */
async function register({ name, email, password, role }, actor = null) {
  const existing = await User.findOne({ email });
  if (existing) throw AppError.conflict('An account with this e-mail already exists');

  const isFirstUser = (await User.estimatedDocumentCount()) === 0;
  const actorIsAdmin = actor && actor.role === ROLES.ADMIN;

  let assignedRole = ROLES.OPERATOR;
  if (isFirstUser) {
    assignedRole = ROLES.ADMIN;
  } else if (role && role !== ROLES.OPERATOR) {
    if (!actorIsAdmin) throw AppError.forbidden('Only an administrator can create ADMIN or WAREHOUSE accounts');
    assignedRole = role;
  } else if (role) {
    assignedRole = role;
  }

  const user = await User.create({ name, email, password, role: assignedRole });
  return { user: user.toJSON(), token: signToken(user), expiresIn: config.jwt.expiresIn };
}

async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+password');
  const passwordOk = user ? await user.comparePassword(password) : await bcrypt.compare(password, DUMMY_HASH);
  if (!user || !passwordOk || !user.isActive) throw AppError.unauthorized('Invalid email or password');
  return { user: user.toJSON(), token: signToken(user), expiresIn: config.jwt.expiresIn };
}

module.exports = { register, login, signToken, verifyToken, getUserFromToken };
