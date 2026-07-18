import { io, Socket } from 'socket.io-client';
import { getGuestKey, getGuestName } from '../store/guest';

let socket: Socket | null = null;
let lastToken: string | null = null;

/** 单例 socket:登录用户带 JWT,匿名带 guestKey;曾被手动断开则自动重连 */
export function getSocket(): Socket {
  const token = localStorage.getItem('token');
  if (socket && lastToken === token) {
    // pagehide 等场景手动 disconnect 过的 socket 不会自动重连,需要显式唤醒
    if (!socket.connected) socket.connect();
    return socket;
  }
  socket?.disconnect();
  lastToken = token;
  socket = io('/', {
    auth: token
      ? { token }
      : { guestKey: getGuestKey(), guestName: getGuestName() },
  });
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
  lastToken = null;
}
