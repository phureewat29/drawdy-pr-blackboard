/** Opening a PR: read it, build its review, and pin its board. */

import type { Theme } from "../lib/card.ts";
import { plural } from "../lib/fp.ts";
import { pageCount, parsePrUrl, prKey, prLabel, type Github, type PrFile, type PrInfo, type PrRef } from "../lib/github.ts";
import { planBoard, shiftPlan, type BoardPlan, type Point } from "../lib/layout.ts";
import type { Review } from "../lib/model.ts";
import { viewportOf } from "./camera.ts";
import type { Ddp } from "./ddp.ts";
import { reviewElements } from "./elements.ts";
import type { Parser } from "./parser.ts";
import type { Progress } from "./progress.ts";
import { findFreeSpot } from "./space.ts";
import type { Store } from "./store.ts";
import { inWords } from "./words.ts";

/** A review, with its board's plan when it was just built. */
export type Loaded = { review: Review; plan: BoardPlan | null };

/** What reading a PR takes. */
export type Loaders = { github: Github; store: Store; parser: Parser };

/** What pinning a board takes; `theme` is the one Drawdy shows the reader who pins it. */
export type Pinning = { ddp: Ddp; generateId: () => string; theme: () => Theme };

/** The PR and file list last read, so a retry after the parser failed costs no GitHub request. */
let lastRead: { key: string; pr: PrInfo; files: PrFile[] } | null = null;

/**
 * The review for a PR's current head: this device's copy when it has one. `fresh` reads GitHub again and builds
 * the review anew, past that copy and the last read.
 */
export const loadReview = async ({ github, store, parser }: Loaders, ref: PrRef, progress: Progress, fresh = false): Promise<Loaded> => {
    const key = prKey(ref);
    progress.step("pr", "active");
    const again = !fresh && lastRead?.key === key ? lastRead : null;
    const pr = again?.pr ?? (await github.pr(ref));
    if (!again && !fresh) {
        const kept = await store.review(key, pr.headSha);
        if (kept) return { review: kept, plan: null };
    }
    // A big PR's file list takes a request per 100 files: the step counts them as they come, then says how many it took.
    const requests = 1 + pageCount(pr.changedFiles);
    const big = requests > 2;
    let answered = 1;
    const count = () => progress.step("pr", "active", { note: "GitHub requests", count: [answered, requests] });
    if (big) count();
    const files = again?.files ?? (await github.files(ref, pr.changedFiles, big ? () => (answered++, count()) : undefined));
    lastRead = { key, pr, files };
    progress.step("pr", "done", big ? { note: `${requests.toLocaleString("en-US")} GitHub requests` } : {});
    const { review, plan } = await parser.analyse(pr, files, progress);
    progress.step("link", "done");
    lastRead = null;
    await store.saveReview(key, review);
    return { review, plan };
};

/** A pinned board's review at its head commit: this device's copy, else GitHub's. Rejects in words when the PR has new commits since. */
export const reviewAt = async (loaders: Loaders, key: string, sha: string, progress: Progress): Promise<Review> => {
    const kept = await loaders.store.review(key, sha);
    if (kept) return kept;
    // A key is `owner/repo#123`, which reads as a PR reference.
    const ref = parsePrUrl(key);
    if (!ref) throw inWords(`PR Blackboard can't tell which PR ${key} is.`);
    const { review } = await loadReview(loaders, ref, progress);
    if (review.pr.headSha !== sha) throw inWords(`${prLabel(ref)} has new commits since it was laid out here. Open it again to lay out the latest version.`, "New commits");
    return review;
};

/** Where a plan's top-left goes: so its PR card's top-left lands on `corner`, else in free space near the camera. */
const placeAt = async (ddp: Ddp, plan: BoardPlan, corner?: Point): Promise<Point> => {
    const card = plan.pins.get("pr");
    if (corner && card) return { x: plan.bounds.x + corner.x - card.x, y: plan.bounds.y + corner.y - card.y };
    const view = await viewportOf(ddp);
    const wanted = view
        ? { x: Math.round(view.x + view.width * 0.06), y: Math.round(view.y + view.height * 0.08), width: plan.bounds.width, height: plan.bounds.height }
        : { ...plan.bounds, x: 0, y: 0 };
    return findFreeSpot(ddp, wanted);
};

/** Pins a review's board in one add call, so one undo removes it. Rejects in words when Drawdy refuses it. */
export const pinBoard = async (deps: Pinning, review: Review, plan: BoardPlan | null, progress: Progress, corner?: Point): Promise<void> => {
    progress.step("pin", "active", { label: `Pinning ${plural(review.pins.length, "card")}` });
    const theme = deps.theme();
    const board = plan ?? planBoard(review);
    const { elements } = reviewElements(review, shiftPlan(board, await placeAt(deps.ddp, board, corner)), deps.generateId, theme);
    try {
        await deps.ddp.call("command:scene:add-drawdy-elements", { elements });
    } catch (err) {
        console.error("[pr-blackboard]", err);
        throw inWords("Couldn't pin the board. Try again.");
    }
};
