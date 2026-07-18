import { io, Socket } from 'socket.io-client';
import { getGuestName } from '../store/guest';
import { ensurePow } from './pow';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) {
    if (!socket.connected) void ensurePow().then(() => socket?.connect());
    return socket;
  }
  socket = io('/', {
    withCredentials: true,
    auth: { guestName: getGuestName() },
    autoConnect: false,
  });
  socket.on('connect_error', (error) => {
    if (error.message === 'POW_REQUIRED') {
      void ensurePow(true).then(() => socket?.connect());
    }
  });
  void ensurePow().then(() => socket?.connect());
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}
