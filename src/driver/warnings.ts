/**
 * What a board can't show of its PR, as CI warnings: a short title and a
 * plain detail line, for the loading view as each is found and for the PR
 * card after. The card limit, the read limits, files too long to read or
 * not found, diffs GitHub leaves out, files past GitHub's list, and GitHub
 * requests running low.
 */

import { unpinnedText } from "../lib/card.ts";
import { count, plural } from "../lib/fp.ts";
import type { Review } from "../lib/model.ts";
import type { Annotation } from "../shared/protocol.ts";
import type { Unread } from "./progress.ts";
import type { Quota } from "./quota.ts";

const warning = (title: string, detail: string): Annotation => ({ level: "warning", title, detail });

/** At this many GitHub requests left or fewer, the loading view and the PR card say so. */
export const LOW_QUOTA = 10;

/**
 * The limits the words name: `LIMITS.cards` in lib/model.ts and `READ` in
 * lib/sources.ts, which the driver can't import without the parser coming
 * along. A test holds them equal.
 */
export const SAID = { cards: 32, code: 40, tests: 40, chars: 400_000 } as const;

export const cardLimit = (unpinned: Review["unpinned"]): Annotation | null => {
    const text = unpinnedText(unpinned);
    return text ? warning("Card limit reached", `The board holds ${SAID.cards} cards: ${text}.`) : null;
};

export const notRead = (left: number): Annotation | null =>
    left > 0 ? warning(`${plural(left, "file")} not read`, `PR Blackboard reads up to ${SAID.code} code and ${SAID.tests} test files, so some cards have no lines.`) : null;

export const tooLong = (paths: readonly string[]): Annotation | null =>
    paths.length > 0 ? warning(`${plural(paths.length, "file")} too long to read`, `Over ${count(SAID.chars)} characters, so ${paths.length === 1 ? "its cards have" : "their cards have"} no lines.`) : null;

export const notFound = (paths: readonly string[]): Annotation | null =>
    paths.length > 0 ? warning(`${plural(paths.length, "file")} not found`, `GitHub didn't send ${paths.length === 1 ? "it, so its" : "them, so their"} cards have no lines.`) : null;

/** Changed code and test files whose diff GitHub left out: a very large one. */
export const noDiff = (review: Review): Annotation | null => {
    const n = review.files.filter((f) => !f.hasPatch && f.status !== "removed" && (f.role === "code" || f.role === "test") && f.lang !== "text" && f.additions + f.deletions > 0).length;
    return n > 0 ? warning(`No diff for ${plural(n, "file")}`, "GitHub leaves out diffs too large to show.") : null;
};

/** GitHub lists 3,000 of a PR's files at most. */
export const listCut = (review: Review): Annotation | null => {
    const total = review.pr.changedFiles;
    const shown = review.files.length;
    return total > shown ? warning(`GitHub lists ${count(shown)} of ${count(total)} files`, `The other ${count(total - shown)} aren't on the board.`) : null;
};

/** GitHub requests running low, until the count resets. */
export const quotaLow = (quota: Quota | null, now: number): Annotation | null => {
    if (!quota || quota.left > LOW_QUOTA || (quota.resetAt > 0 && quota.resetAt <= now)) return null;
    const title = quota.left === 0 ? "No GitHub requests left" : `${plural(quota.left, "GitHub request")} left`;
    const at = quota.resetAt > 0 ? ` Resets at ${new Date(quota.resetAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.` : "";
    return warning(title, `GitHub allows this network ${quota.limit} an hour.${at}`);
};

/**
 * Everything a board can't show, for its PR card, in the loading view's
 * order: the card limit first, then what reading the PR found, then what
 * reading its files did; what reading left out only when this session read it.
 */
export const warningsOf = (review: Review, unread: Unread | undefined, quota: Quota | null, now: number): Annotation[] =>
    [cardLimit(review.unpinned), quotaLow(quota, now), listCut(review), notRead(unread?.left ?? 0), tooLong(unread?.long ?? []), notFound(unread?.missing ?? []), noDiff(review)].filter(
        (w): w is Annotation => w !== null
    );
