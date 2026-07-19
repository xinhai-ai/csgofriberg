import { io, Socket } from 'socket.io-client';
import { ensurePow } from './pow';
import { ensureGuestSession, hasAuthHint } from './session';

let socket: Socket | null = null;
let connectTask: Promise<void> | null = null;

async function prepareSocketIdentity(): Promise<void> {
  await Promise.all([
    ensurePow(),
    hasAuthHint() ? Promise.resolve() : ensureGuestSession(),
  ]);
}

function connectSocket(): void {
  if (!socket || socket.connected || socket.active || connectTask) return;
  const target = socket;
  const task = prepareSocketIdentity()
    .then(() => {
      if (socket === target && !target.connected && !target.active) target.connect();
    })
    .catch(() => undefined)
    .finally(() => {
      if (connectTask === task) connectTask = null;
    });
  connectTask = task;
}

export function getSocket(): Socket {
  if (socket) {
    connectSocket();
    return socket;
  }
  socket = io('/', {
    withCredentials: true,
    autoConnect: false,
    transports: ['websocket'],
  });
  socket.on('connect_error', (error) => {
    if (error.message === 'POW_REQUIRED') {
      void ensurePow(true).then(connectSocket).catch(() => undefined);
    } else if (error.message === 'IDENTITY_REQUIRED') {
      void ensureGuestSession(true).then(connectSocket).catch(() => undefined);
    }
  });
  connectSocket();
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
  connectTask = null;
}
