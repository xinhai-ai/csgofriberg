import { io, Socket } from 'socket.io-client';
import { ensurePow } from './pow';
import { ensureGuestSession, hasAuthHint } from './session';

let socket: Socket | null = null;

async function prepareSocketIdentity(): Promise<void> {
  await Promise.all([
    ensurePow(),
    hasAuthHint() ? Promise.resolve() : ensureGuestSession(),
  ]);
}

export function getSocket(): Socket {
  if (socket) {
    if (!socket.connected) void prepareSocketIdentity().then(() => socket?.connect());
    return socket;
  }
  socket = io('/', {
    withCredentials: true,
    autoConnect: false,
  });
  socket.on('connect_error', (error) => {
    if (error.message === 'POW_REQUIRED') {
      void ensurePow(true).then(() => socket?.connect());
    } else if (error.message === 'IDENTITY_REQUIRED') {
      void ensureGuestSession(true).then(() => socket?.connect());
    }
  });
  void prepareSocketIdentity().then(() => socket?.connect());
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}
