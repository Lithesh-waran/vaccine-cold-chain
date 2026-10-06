import { io } from 'socket.io-client';

let socket;
export function getSocket(token) {
  if (!token) return null;
  if (socket?.connected) return socket;
  if (!socket) socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000', { auth: { token }, autoConnect: false, reconnection: true });
  socket.auth = { token };
  if (!socket.connected) socket.connect();
  return socket;
}
export function closeSocket() { socket?.disconnect(); socket = null; }
