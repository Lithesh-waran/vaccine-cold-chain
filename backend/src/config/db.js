'use strict';

const mongoose = require('mongoose');
const config = require('./env');
const logger = require('../utils/logger');

let listenersAttached = false;

async function connectDB(uri = config.mongoUri) {
  mongoose.set('strictQuery', true);

  if (!listenersAttached) {
    listenersAttached = true;
    mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
    mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
    mongoose.connection.on('error', (err) => logger.error('MongoDB error:', err.message));
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  logger.info(`MongoDB connected (${mongoose.connection.host}/${mongoose.connection.name})`);
  return mongoose.connection;
}

async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info('MongoDB connection closed');
  }
}

module.exports = { connectDB, disconnectDB };
