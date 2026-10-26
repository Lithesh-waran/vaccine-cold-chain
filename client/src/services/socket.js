import { io } from 'socket.io-client';

let socket;
export function getSocket(token) {
  if (!token) return null;
  if (socket?.connected) return socket;
  const defaultSocketUrl = typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
    ? 'https://coldchain-api-m3ym.onrender.com'
    : 'http://localhost:5000';
  if (!socket) socket = io(import.meta.env.VITE_SOCKET_URL || defaultSocketUrl, { auth: { token }, autoConnect: false, reconnection: true });
  socket.auth = { token };
  if (!socket.connected) socket.connect();
  return socket;
}
export function closeSocket() { socket?.disconnect(); socket = null; }
