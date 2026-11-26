export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SeededRng {
  private readonly rand: () => number;

  constructor(seed: number) {
    this.rand = mulberry32(seed);
  }

  next(): number {
    return this.rand();
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.rand();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error('Cannot pick from an empty array');
    }
    const item = arr[Math.floor(this.rand() * arr.length)];
    if (item === undefined) {
      throw new Error('SeededRng.pick index out of range');
    }
    return item;
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.rand() * (i + 1));
      const a = copy[i];
      const b = copy[j];
      if (a !== undefined && b !== undefined) {
        copy[i] = b;
        copy[j] = a;
      }
    }
    return copy;
  }
}

export function createDailyStream(utcDate: string, salt: string): SeededRng {
  return new SeededRng(hashString(`${utcDate}::${salt}`));
}

const UTC_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseUtcDayNumber(utcDate: string): number {
  if (!UTC_DATE_RE.test(utcDate)) return 0;
  const parsed = new Date(`${utcDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 0;
  return Math.floor(parsed.getTime() / 86_400_000);
}

/**
 * Picks an item for `utcDate` by shuffling `items` once per full N-day cycle and
 * avoiding boundary repeats between consecutive cycles so adjacent days never repeat.
 */
export function pickDailyRotation<T>(utcDate: string, salt: string, items: readonly T[]): T {
  const n = items.length;
  if (n === 0) {
    throw new Error('Cannot pick from an empty array');
  }
  if (n === 1) return items[0]!;
  const dayNum = parseUtcDayNumber(utcDate);
  if (n === 2) return items[((dayNum % 2) + 2) % 2]!;

  const buildCycleOrder = (cycle: number): T[] => {
    const order = new SeededRng(hashString(`cycle:${cycle}::${salt}`)).shuffle(items);
    if (cycle > 0) {
      const prevOrder = new SeededRng(hashString(`cycle:${cycle - 1}::${salt}`)).shuffle(items);
      if (order[0] === prevOrder[n - 1]) {
        const tmp = order[0]!;
        order[0] = order[1]!;
        order[1] = tmp;
      }
    }
    return order;
  };

  const cycle = Math.floor(dayNum / n);
  const pos = ((dayNum % n) + n) % n;
  return buildCycleOrder(cycle)[pos]!;
}

export function getUtcDateString(override?: string | null): string {
  if (override && UTC_DATE_RE.test(override)) {
    const parsed = new Date(`${override}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === override) {
      return override;
    }
  }
  return new Date().toISOString().slice(0, 10);
}

type DurationFormatCtor = new (
  locale: string,
  options: {
    style: 'digital';
    hours: '2-digit';
    minutes: '2-digit';
    seconds: '2-digit';
    hoursDisplay: 'always';
  },
) => { format: (input: { hours: number; minutes: number; seconds: number }) => string };

export function formatTimeUntilNextUtcDay(nowMs: number = Date.now()): string {
  const elapsedSec = ((Math.floor(nowMs / 1000) % 86_400) + 86_400) % 86_400;
  const remainingSec = 86_400 - elapsedSec;
  const hours = Math.floor(remainingSec / 3600);
  const minutes = Math.floor((remainingSec % 3600) / 60);
  const seconds = remainingSec % 60;

  const intlRecord = Intl as { DurationFormat?: DurationFormatCtor };
  if (typeof intlRecord.DurationFormat === 'function') {
    const formatter = new intlRecord.DurationFormat('en-US', {
      style: 'digital',
      hours: '2-digit',
      minutes: '2-digit',
      seconds: '2-digit',
      hoursDisplay: 'always',
    });
    return formatter.format({ hours, minutes, seconds });
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
