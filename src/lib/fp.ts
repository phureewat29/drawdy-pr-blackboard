/**
 * The small helpers PR Blackboard needs, with es-toolkit's names and
 * behaviour. Drawdy's marketplace build only lets an extension import
 * `@drawdy/driver-protocol`, so they live here instead of coming from npm.
 */

// Values

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export const isDefined = <T>(x: T | null | undefined): x is T => x != null;

// Collections

/** Keeps the first item for each key, in order. */
export const uniqBy = <T>(xs: readonly T[], key: (x: T) => string): T[] => {
    const seen = new Set<string>();
    return xs.filter((x) => !seen.has(key(x)) && Boolean(seen.add(key(x))));
};

/** A stable sort by several keys, compared in turn. */
export const sortBy = <T>(xs: readonly T[], ...keys: ((x: T) => number | string)[]): T[] =>
    [...xs].sort((a, b) => {
        for (const key of keys) {
            const ka = key(a);
            const kb = key(b);
            if (ka < kb) return -1;
            if (ka > kb) return 1;
        }
        return 0;
    });

/** Items grouped by key, each group in the items' order. The record has no prototype, so a key such as `constructor` is safe. */
export const groupBy = <T, K extends PropertyKey>(xs: readonly T[], key: (x: T) => K): Record<K, T[]> => {
    const groups = Object.create(null) as Record<K, T[]>;
    for (const x of xs) (groups[key(x)] ??= []).push(x);
    return groups;
};

/** A record with each value mapped; no prototype, as `groupBy`. */
export const mapValues = <K extends PropertyKey, T, U>(record: Record<K, T>, fn: (value: T) => U): Record<K, U> => {
    const out = Object.create(null) as Record<K, U>;
    for (const k of Object.keys(record) as K[]) out[k] = fn(record[k]);
    return out;
};

/** The items that pass a test, then those that don't, each in order. */
export const partition = <T>(xs: readonly T[], test: (x: T) => boolean): [T[], T[]] => {
    const pass: T[] = [];
    const fail: T[] = [];
    for (const x of xs) (test(x) ? pass : fail).push(x);
    return [pass, fail];
};

export const sumBy = <T>(xs: readonly T[], value: (x: T) => number): number => {
    let total = 0;
    for (const x of xs) total += value(x);
    return total;
};

export const sum = (xs: readonly number[]): number => sumBy(xs, (x) => x);

/** The first item whose value is least; undefined when there are none. */
export const minBy = <T>(xs: readonly T[], value: (x: T) => number): T | undefined => {
    if (xs.length === 0) return undefined;
    let best = xs[0];
    let least = value(best);
    for (let i = 1; i < xs.length; i++) {
        const v = value(xs[i]);
        if (v < least) {
            best = xs[i];
            least = v;
        }
    }
    return best;
};

/** Appends a value to its key's list in a map of lists. A Map, unlike `groupBy`'s object, takes any key. */
export const pushTo = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
    const values = map.get(key);
    if (values) values.push(value);
    else map.set(key, [value]);
};

// Functions

/** Where `memoize` keeps results: a Map, or a WeakMap to keep a result only as long as its object. */
type MemoizeCache<K, V> = { has: (key: K) => boolean; get: (key: K) => V | undefined; set: (key: K, value: V) => unknown };

/** Caches a function's result for each first argument. */
export const memoize =
    <K, V>(fn: (key: K) => V, { cache = new Map<K, V>() }: { cache?: MemoizeCache<K, V> } = {}) =>
    (key: K): V => {
        if (cache.has(key)) return cache.get(key) as V;
        const value = fn(key);
        cache.set(key, value);
        return value;
    };

/** Runs `fn` on the first call only, and gives its result to every call. */
export const once = <T>(fn: () => T): (() => T) => {
    let done = false;
    let value: T;
    return () => {
        if (!done) {
            value = fn();
            done = true;
        }
        return value;
    };
};

// Async

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs async jobs one at a time, in order. A failing job does not stop the ones queued after it. */
export const serial = () => {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(job: () => Promise<T>): Promise<T> => {
        const run = tail.then(job, job);
        tail = run.catch(() => undefined);
        return run;
    };
};

/** A pool of `size` slots: at most that many jobs run at once, the rest in turn. */
export const limiter = (size: number) => {
    let running = 0;
    const waiting: (() => void)[] = [];
    return async <T>(job: () => Promise<T>): Promise<T> => {
        if (running >= size) await new Promise<void>((resolve) => waiting.push(resolve));
        running++;
        try {
            return await job();
        } finally {
            running--;
            waiting.shift()?.();
        }
    };
};

// Text

/** A count with its digits grouped: `1,009,257`. */
export const count = (n: number): string => n.toLocaleString("en-US");

/** "1 file", "2,188 files". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${count(n)} ${n === 1 ? one : many}`;
