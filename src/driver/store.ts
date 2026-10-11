import type { Review } from "../lib/model.ts";
import type { Ddp } from "./ddp.ts";

/** Bump when the shape of a stored review, or how a review is built, changes, so old copies are refetched. */
const REVIEW_VERSION = 8;

export type Store = {
    /** The review last built for a pull request, when it is for this head commit. */
    review: (key: string, sha: string) => Promise<Review | null>;
    saveReview: (key: string, review: Review) => Promise<void>;
};

/**
 * Only what the board and Read all need: a file with no card keeps its name,
 * role and counts, not its diff. Bun's 2,188-file rewrite would otherwise
 * store 82 MB.
 */
const compact = (review: Review): Review => {
    const carded = new Set(review.pins.map((p) => p.path));
    return { ...review, files: review.files.map((f) => (carded.has(f.path) ? f : { ...f, hunks: [], symbols: [], loose: [], cases: [] })) };
};

/**
 * What PR Blackboard keeps on this device, in Drawdy's per-extension storage:
 * each pull request's review, so reopening it costs one GitHub request
 * instead of several, and the parser's files (`grammars.ts`). Without the
 * storage permission everything still works; nothing is kept.
 */
export const createStore = (ddp: Ddp): Store => ({
    review: async (key, sha) => {
        const got = await ddp.tryCall("command:kv-storage:get", { key: `review:${key}` });
        const payload = got?.got;
        return payload && payload.version === REVIEW_VERSION && payload.sha === sha ? (payload.review as Review) : null;
    },
    saveReview: async (key, review) => {
        await ddp.tryCall("command:kv-storage:set", {
            key: `review:${key}`,
            payload: { version: REVIEW_VERSION, sha: review.pr.headSha, review: compact(review) },
        });
    },
});
