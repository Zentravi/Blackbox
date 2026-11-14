/**
 * Deterministic pseudo-random utilities.
 *
 * All simulation noise flows through these helpers so that a given
 * (seed, tick, stream) tuple always produces the same value — which makes
 * scenarios reproducible regardless of how the operator interacted earlier.
 */

/** 32-bit FNV-1a string/number hash. */
export function hashParts(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  const str = parts.join("|");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG — small, fast, deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic float in [0, 1) for a given set of key parts. */
export function rand(seed: number, ...parts: (string | number)[]): number {
  return mulberry32(hashParts(seed, ...parts))();
}

/** Deterministic float in [-1, 1) with the given amplitude. */
export function noise(seed: number, amplitude: number, ...parts: (string | number)[]): number {
  return (rand(seed, ...parts) * 2 - 1) * amplitude;
}

/** Smooth deterministic oscillation in [-1, 1] — gives metrics an organic drift. */
export function wave(tick: number, period: number, phase = 0): number {
  return Math.sin((tick / period) * Math.PI * 2 + phase);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function round(v: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Pick an element deterministically. */
export function pick<T>(items: readonly T[], seed: number, ...parts: (string | number)[]): T {
  const idx = Math.floor(rand(seed, ...parts) * items.length);
  return items[Math.min(idx, items.length - 1)];
}
