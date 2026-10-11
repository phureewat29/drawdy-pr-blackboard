/**
 * The handful of collection helpers PR Blackboard needs, es-toolkit style.
 *
 * Drawdy's marketplace build only lets an extension import
 * `@drawdy/driver-protocol`, so these live here instead of coming from npm.
 */

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export const isDefined = <T>(x: T | null | undefined): x is T => x != null;

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

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs async jobs one at a time, in order. A failing job does not stop the
 * ones queued after it.
 */
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

/** A count with its digits grouped: `1,009,257`. */
export const count = (n: number): string => n.toLocaleString("en-US");

/** "1 file", "2,188 files". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${count(n)} ${n === 1 ? one : many}`;
