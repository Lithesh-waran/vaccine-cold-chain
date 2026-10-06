import { useEffect, useState } from 'react';
import { getSocket } from '../services/socket';
import { useAuth } from '../context/AuthContext';

export function useLive({ dashboard = false, shipmentId = null, events = [] } = {}) {
  const { token } = useAuth(); const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!token) return undefined;
    const socket = getSocket(token); if (!socket) return undefined;
    const onConnect = () => { setConnected(true); if (dashboard) socket.emit('dashboard:join'); if (shipmentId) socket.emit('shipment:join', shipmentId); };
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect); socket.on('disconnect', onDisconnect);
    if (socket.connected) onConnect();
    const listeners = events.map(([name, handler]) => { socket.on(name, handler); return [name, handler]; });
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); listeners.forEach(([n, h]) => socket.off(n, h)); if (dashboard) socket.emit('dashboard:leave'); if (shipmentId) socket.emit('shipment:leave', shipmentId); };
  }, [token, dashboard, shipmentId]);
  return connected;
}
