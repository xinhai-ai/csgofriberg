import crypto from 'crypto';
import { config } from '../config';

export function guestNameFromKey(key: string): string {
  const value = crypto
    .createHmac('sha256', config.guestIdSalt)
    .update('csgofriberg-guest-id-v1\0', 'ascii')
    .update(key, 'utf8')
    .digest()
    .readUInt32BE(0) % (36 ** 5);
  return `访客#${value.toString(36).padStart(5, '0').toUpperCase()}`;
}

export function userNameFromUsername(username: string): string {
  const value = crypto
    .createHmac('sha256', config.guestIdSalt)
    .update('csgofriberg-user-id-v1\0', 'ascii')
    .update(username, 'utf8')
    .digest()
    .readUInt32BE(0) % (36 ** 5);
  return `用户#${value.toString(36).padStart(5, '0').toUpperCase()}`;
}
