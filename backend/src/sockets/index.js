'use strict';

const { Server } = require('socket.io');
const { corsOptions } = require('../config/cors');
const { DASHBOARD_ROOM, shipmentRoom } = require('../config/constants');
const authService = require('../services/authService');
const shipmentService = require('../services/shipmentService');
const socketEmitter = require('./socketEmitter');
const logger = require('../utils/logger');

function tokenFromHandshake(socket) {
  const { auth = {}, headers = {} } = socket.handshake;
  if (auth.token) return String(auth.token).replace(/^Bearer\s+/i, '');
  const header = headers.authorization;
  if (header && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '');
  return null;
}

const reply = (ack, payload) => {
  if (typeof ack === 'function') ack(payload);
};

/**
 * Attaches Socket.IO to the HTTP server.
 * Clients authenticate with their JWT (handshake `auth: { token }`) and then subscribe to rooms:
 *   socket.emit('shipment:join', '<shipment id or code>', ack)   socket.emit('shipment:leave', ...)
 *   socket.emit('dashboard:join', ack)                           socket.emit('dashboard:leave', ack)
 */
function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: corsOptions.origin, methods: ['GET', 'POST'], credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token = tokenFromHandshake(socket);
      if (!token) return next(new Error('Authentication required'));
      const user = await authService.getUserFromToken(token);
      socket.data.user = { id: String(user._id), role: user.role, name: user.name };
      return next();
    } catch (err) {
      return next(new Error(err.message || 'Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    logger.debug(`Socket connected ${socket.id} (${socket.data.user.role})`);

    socket.on('shipment:join', async (payload, ack) => {
      try {
        const ref = payload && typeof payload === 'object' ? payload.shipmentId : payload;
        if (!ref || typeof ref !== 'string') return reply(ack, { ok: false, message: 'shipmentId is required' });
        const shipment = await shipmentService.getByRef(ref);
        const room = shipmentRoom(String(shipment._id));
        await socket.join(room);
        return reply(ack, { ok: true, room, shipmentId: String(shipment._id), shipmentCode: shipment.shipmentId });
      } catch (err) {
        return reply(ack, { ok: false, message: err.statusCode === 404 ? 'Shipment not found' : 'Could not join shipment room' });
      }
    });

    socket.on('shipment:leave', async (payload, ack) => {
      try {
        const ref = payload && typeof payload === 'object' ? payload.shipmentId : payload;
        const shipment = await shipmentService.getByRef(String(ref));
        await socket.leave(shipmentRoom(String(shipment._id)));
        return reply(ack, { ok: true });
      } catch (err) {
        return reply(ack, { ok: false, message: 'Could not leave shipment room' });
      }
    });

    socket.on('dashboard:join', async (ack) => {
      await socket.join(DASHBOARD_ROOM);
      reply(typeof ack === 'function' ? ack : null, { ok: true, room: DASHBOARD_ROOM });
    });

    socket.on('dashboard:leave', async (ack) => {
      await socket.leave(DASHBOARD_ROOM);
      reply(typeof ack === 'function' ? ack : null, { ok: true });
    });

    socket.on('disconnect', (reason) => logger.debug(`Socket disconnected ${socket.id}: ${reason}`));
  });

  socketEmitter.setIo(io);
  return io;
}

module.exports = { initSocket };
