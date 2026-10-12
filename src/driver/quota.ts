import type { Fetch } from "../lib/github.ts";

/** GitHub's API quota for this network, as its last answer told it: requests left, of how many an hour, and when the count resets (0 when unknown). */
export type Quota = { left: number; limit: number; resetAt: number };

const API = "https://api.github.com/";

/** A number from a header, or null when it has none. */
const header = (res: Response, name: string): number | null => {
    const value = Number(res.headers.get(name) ?? Number.NaN);
    return Number.isFinite(value) ? value : null;
};

/** `fetch`, reading the quota off every answer from GitHub's API: what an open costs shows on the loading view. */
export const watchQuota = (fetch: Fetch): { fetch: Fetch; quota: () => Quota | null } => {
    let quota: Quota | null = null;
    return {
        fetch: async (url, init) => {
            const res = await fetch(url, init);
            const left = url.startsWith(API) ? header(res, "x-ratelimit-remaining") : null;
            if (left !== null) quota = { left, limit: header(res, "x-ratelimit-limit") ?? 60, resetAt: (header(res, "x-ratelimit-reset") ?? 0) * 1000 };
            return res;
        },
        quota: () => quota,
    };
};
