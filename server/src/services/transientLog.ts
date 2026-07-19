import { isRedisTimeoutError } from '../redis';

const LOG_INTERVAL_MS = 5_000;
const states = new Map<string, { lastAt: number; suppressed: number }>();

function shouldLog(label: string): { log: boolean; suppressed: number } {
  const now = Date.now();
  const state = states.get(label) ?? { lastAt: 0, suppressed: 0 };
  if (now - state.lastAt < LOG_INTERVAL_MS) {
    state.suppressed += 1;
    states.set(label, state);
    return { log: false, suppressed: 0 };
  }
  states.set(label, { lastAt: now, suppressed: 0 });
  return { log: true, suppressed: state.suppressed };
}

export function logTransientWarning(label: string, message: string): void {
  const decision = shouldLog(label);
  if (!decision.log) return;
  const suffix = decision.suppressed ? `, suppressed=${decision.suppressed}` : '';
  console.warn(`${label} ${message}${suffix}`);
}

export function logTransientError(label: string, err: unknown): void {
  if (!isRedisTimeoutError(err)) {
    console.error(label, err);
    return;
  }

  const decision = shouldLog(label);
  if (!decision.log) return;
  const suffix = decision.suppressed ? `, suppressed=${decision.suppressed}` : '';
  console.warn(`${label} Redis command timeout${suffix}`);
}
