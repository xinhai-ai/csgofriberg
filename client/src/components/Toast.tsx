import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import ModalPortal from './ModalPortal';
import styles from './Toast.module.css';

type ToastTone = 'error' | 'success' | 'info';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  createdAt: number;
}

const listeners = new Set<() => void>();
const timers = new Map<number, number>();
let items: ToastItem[] = [];
let nextId = 1;

function emit(): void {
  for (const listener of listeners) listener();
}

function dismiss(id: number): void {
  const timer = timers.get(id);
  if (timer) window.clearTimeout(timer);
  timers.delete(id);
  const next = items.filter((item) => item.id !== id);
  if (next.length === items.length) return;
  items = next;
  emit();
}

function scheduleDismiss(id: number, duration: number): void {
  const previous = timers.get(id);
  if (previous) window.clearTimeout(previous);
  timers.set(id, window.setTimeout(() => dismiss(id), duration));
}

function show(message: string, tone: ToastTone, duration = tone === 'error' ? 5_000 : 3_500): number {
  const normalized = message.trim();
  if (!normalized) return 0;
  const now = Date.now();
  const duplicate = items.find(
    (item) => item.tone === tone && item.message === normalized && now - item.createdAt < 1_500
  );
  if (duplicate) {
    scheduleDismiss(duplicate.id, duration);
    return duplicate.id;
  }
  const item = { id: nextId++, message: normalized, tone, createdAt: now };
  const retained = items.slice(-3);
  for (const removed of items.slice(0, Math.max(0, items.length - retained.length))) {
    const timer = timers.get(removed.id);
    if (timer) window.clearTimeout(timer);
    timers.delete(removed.id);
  }
  items = [...retained, item];
  emit();
  scheduleDismiss(item.id, duration);
  return item.id;
}

export const toast = {
  error: (message: string, duration?: number) => show(message, 'error', duration),
  success: (message: string, duration?: number) => show(message, 'success', duration),
  info: (message: string, duration?: number) => show(message, 'info', duration),
  dismiss,
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ToastItem[] {
  return items;
}

const ICONS = {
  error: CircleAlert,
  success: CircleCheck,
  info: Info,
};

export default function ToastViewport() {
  const visibleItems = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return (
    <ModalPortal>
      <div className={styles.viewport} aria-live="polite" aria-atomic="false">
        {visibleItems.map((item) => {
          const Icon = ICONS[item.tone];
          return (
            <div
              className={`${styles.toast} ${styles[item.tone]}`}
              key={item.id}
              role={item.tone === 'error' ? 'alert' : 'status'}
            >
              <Icon className={styles.icon} size={19} aria-hidden="true" />
              <p>{item.message}</p>
              <button
                className={styles.close}
                type="button"
                aria-label="关闭通知"
                title="关闭"
                onClick={() => dismiss(item.id)}
              >
                <X size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ModalPortal>
  );
}
