import { io, Socket } from 'socket.io-client';
import { ensureGuestSession, hasAuthHint } from './session';

let socket: Socket | null = null;
let connectTask: Promise<void> | null = null;
let latestResourceVersionNotice: unknown;
const resourceVersionListeners = new Set<(notice: unknown) => void>();

async function prepareSocketIdentity(): Promise<void> {
  if (!hasAuthHint()) await ensureGuestSession();
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
    if (error.message === 'IDENTITY_REQUIRED') {
      void ensureGuestSession(true).then(connectSocket).catch(() => undefined);
    }
  });
  socket.on('resource:version', (notice) => {
    latestResourceVersionNotice = notice;
    resourceVersionListeners.forEach((listener) => listener(notice));
  });
  connectSocket();
  return socket;
}

export function subscribeResourceVersion(listener: (notice: unknown) => void): () => void {
  resourceVersionListeners.add(listener);
  if (latestResourceVersionNotice !== undefined) listener(latestResourceVersionNotice);
  getSocket();
  return () => resourceVersionListeners.delete(listener);
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
  connectTask = null;
}
