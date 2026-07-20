export const RESOURCE_VERSION = import.meta.env.VITE_RESOURCE_VERSION;

export interface ResourceVersionNotice {
  version: string;
  broadcastAt: number;
}
