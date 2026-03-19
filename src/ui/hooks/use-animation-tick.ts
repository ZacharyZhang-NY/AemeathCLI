import { useEffect, useState } from "react";

interface IAnimationBucket {
  tick: number;
  listeners: Set<(tick: number) => void>;
  timer: NodeJS.Timeout;
}

const animationBuckets = new Map<number, IAnimationBucket>();

function getOrCreateBucket(intervalMs: number): IAnimationBucket {
  const existing = animationBuckets.get(intervalMs);
  if (existing !== undefined) {
    return existing;
  }

  const bucket: IAnimationBucket = {
    tick: 0,
    listeners: new Set(),
    timer: setInterval(() => {
      bucket.tick += 1;
      for (const listener of bucket.listeners) {
        listener(bucket.tick);
      }
    }, intervalMs),
  };

  animationBuckets.set(intervalMs, bucket);
  return bucket;
}

export function useAnimationTick(intervalMs: number, enabled = true): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setTick(0);
      return undefined;
    }

    const bucket = getOrCreateBucket(intervalMs);
    setTick(bucket.tick);

    const listener = (nextTick: number): void => {
      setTick(nextTick);
    };

    bucket.listeners.add(listener);

    return () => {
      bucket.listeners.delete(listener);
      if (bucket.listeners.size === 0) {
        clearInterval(bucket.timer);
        animationBuckets.delete(intervalMs);
      }
    };
  }, [enabled, intervalMs]);

  return tick;
}
