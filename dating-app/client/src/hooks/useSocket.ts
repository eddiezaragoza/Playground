import { useEffect, useCallback } from 'react';
import { getSocket } from '../services/socket';

export function useSocketEvent<T = any>(event: string, handler: (data: T) => void) {
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
  }, [event, handler]);
}

export function useSocketEmit() {
  return useCallback((event: string, data?: any) => {
    const socket = getSocket();
    if (socket?.connected) {
      socket.emit(event, data);
    }
  }, []);
}
