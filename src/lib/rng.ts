/** Small deterministic PRNG (mulberry32) so template problems are reproducible from a seed. */
export type Rng = {
  next(): number; // [0, 1)
  int(min: number, max: number): number; // inclusive
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
  nonZeroInt(min: number, max: number): number;
};

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) =>
    Math.floor(next() * (max - min + 1)) + min;
  return {
    next,
    int,
    pick: (items) => items[int(0, items.length - 1)],
    shuffle: (items) => {
      const arr = [...items];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = int(0, i);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    nonZeroInt: (min, max) => {
      let v = 0;
      while (v === 0) v = int(min, max);
      return v;
    },
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
