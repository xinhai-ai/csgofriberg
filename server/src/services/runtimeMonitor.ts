import { monitorEventLoopDelay, performance } from 'perf_hooks';

export interface RuntimeSnapshot {
  eventLoop: {
    p99Ms: number;
    maxMs: number;
    utilization: number;
    timerDriftMs: number;
  };
  memory: {
    rssMb: number;
    heapUsedMb: number;
    externalMb: number;
  };
  sampledAt: number;
}

const SAMPLE_INTERVAL_MS = 5_000;
const WARN_DELAY_MS = 250;
let stopCurrent: (() => void) | null = null;
let snapshot: RuntimeSnapshot = {
  eventLoop: { p99Ms: 0, maxMs: 0, utilization: 0, timerDriftMs: 0 },
  memory: { rssMb: 0, heapUsedMb: 0, externalMb: 0 },
  sampledAt: Date.now(),
};

function mb(value: number): number {
  return Math.round(value / 1024 / 1024);
}

export function getRuntimeSnapshot(): RuntimeSnapshot {
  return snapshot;
}

export function startRuntimeMonitor(): () => void {
  if (stopCurrent) return stopCurrent;
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  let previousUtilization = performance.eventLoopUtilization();
  let expectedAt = Date.now() + SAMPLE_INTERVAL_MS;
  const timer = setInterval(() => {
    const now = Date.now();
    const utilization = performance.eventLoopUtilization(previousUtilization);
    previousUtilization = performance.eventLoopUtilization();
    const memory = process.memoryUsage();
    snapshot = {
      eventLoop: {
        p99Ms: Math.round(histogram.percentile(99) / 1e6),
        maxMs: Math.round(histogram.max / 1e6),
        utilization: Number(utilization.utilization.toFixed(3)),
        timerDriftMs: Math.max(0, now - expectedAt),
      },
      memory: {
        rssMb: mb(memory.rss),
        heapUsedMb: mb(memory.heapUsed),
        externalMb: mb(memory.external),
      },
      sampledAt: now,
    };
    expectedAt = now + SAMPLE_INTERVAL_MS;
    histogram.reset();
    if (
      snapshot.eventLoop.maxMs >= WARN_DELAY_MS ||
      snapshot.eventLoop.timerDriftMs >= WARN_DELAY_MS
    ) {
      console.warn('[runtime:lag]', JSON.stringify(snapshot));
    }
  }, SAMPLE_INTERVAL_MS);
  timer.unref?.();
  stopCurrent = () => {
    clearInterval(timer);
    histogram.disable();
    stopCurrent = null;
  };
  return stopCurrent;
}
