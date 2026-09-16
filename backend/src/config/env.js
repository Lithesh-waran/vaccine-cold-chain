'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const str = (name, fallback) => {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
};

const num = (name, fallback) => {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a number (received "${value}")`);
  }
  return parsed;
};

const nodeEnv = str('NODE_ENV', 'development');

const config = {
  env: nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: num('PORT', 5000),
  mongoUri: str('MONGODB_URI', 'mongodb://127.0.0.1:27017/vaccine_cold_chain'),
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: str('JWT_EXPIRES_IN', '1d'),
  },
  bcryptSaltRounds: num('BCRYPT_SALT_ROUNDS', 10),
  corsOrigins: str('CORS_ORIGINS', 'http://localhost:3000,http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  simulation: {
    tickIntervalMs: num('SIM_TICK_INTERVAL_MS', 3000),
    timeScale: num('SIM_TIME_SCALE', 60),
    cruiseSpeedKmph: num('SIM_CRUISE_SPEED_KMPH', 50),
    etaBufferFactor: num('SIM_ETA_BUFFER_FACTOR', 1.25),
    sensorTimeoutMs: num('SIM_SENSOR_TIMEOUT_MS', 10000),
    routeToleranceKm: num('SIM_ROUTE_TOLERANCE_KM', 2),
  },
  alerts: {
    expiryWarningDays: num('EXPIRY_WARNING_DAYS', 30),
  },
  inventory: {
    scanIntervalMinutes: num('INVENTORY_SCAN_INTERVAL_MINUTES', 15),
  },

  /** Fail fast on unsafe / missing configuration. Called by server.js before booting. */
  assertValid() {
    const secret = this.jwt.secret;
    if (!secret || secret.length < 32 || /change-?me|your-secret|replace-?me/i.test(secret)) {
      throw new Error(
        'JWT_SECRET is missing or too weak. Run "npm run setup" to generate a .env file, or set a random ' +
          'JWT_SECRET of at least 32 characters.'
      );
    }
    if (this.simulation.tickIntervalMs < 100) {
      throw new Error('SIM_TICK_INTERVAL_MS must be at least 100');
    }
    if (this.simulation.timeScale <= 0) {
      throw new Error('SIM_TIME_SCALE must be greater than 0');
    }
  },
};

module.exports = config;
