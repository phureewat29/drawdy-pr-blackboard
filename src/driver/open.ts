/** Opening a pull request: fetch it, build the review, and pin it to the board. */

import type { DrawdyElementSchema } from "@drawdy/driver-protocol";
import type { Theme } from "../lib/card.ts";
import { plural } from "../lib/fp.ts";
import { pageCount, prKey, type Github, type PrFile, type PrInfo, type PrRef } from "../lib/github.ts";
import { planBoard, shiftPlan, type BoardPlan, type Point } from "../lib/layout.ts";
import type { Review } from "../lib/model.ts";
import { viewportOf } from "./camera.ts";
import type { Ddp } from "./ddp.ts";
import { reviewElements } from "./elements.ts";
import type { Parser } from "./parser.ts";
import { findFreeSpot } from "./space.ts";
import type { Store } from "./store.ts";

/** The loading view's steps; the parser's shows only while it downloads, beside the files'. */
export type LoadStep = "pr" | "parser" | "files" | "pin";

/** A step under way or done, renamed to `label` and given a muted `note` when they are known. */
export type Progress = (step: LoadStep, state: "active" | "done", words?: { label?: string; note?: string }) => void;

/** A review, with its board's plan when it was just built. */
export type Loaded = { review: Review; plan: BoardPlan | null };

/**
 * The pull request and file list last read in this session, so a retry
 * after the parser failed costs no GitHub request.
 */
let lastRead: { key: string; pr: PrInfo; files: PrFile[] } | null = null;

/**
 * The review for a pull request's current head: from this device's copy
 * when it has one. `fresh` reads GitHub again and builds the review anew,
 * ignoring that copy and the last read.
 */
export const loadReview = async (deps: { github: Github; store: Store; parser: Parser }, ref: PrRef, progress: Progress, fresh = false): Promise<Loaded> => {
    const { github, store, parser } = deps;
    const key = prKey(ref);
    progress("pr", "active");
    const again = !fresh && lastRead?.key === key ? lastRead : null;
    const pr = again?.pr ?? (await github.pr(ref));
    if (!again && !fresh) {
        const kept = await store.review(key, pr.headSha);
        if (kept) return { review: kept, plan: null };
    }
    const pages = pageCount(pr.changedFiles);
    progress("pr", "active", pages > 1 ? { note: `${(1 + pages).toLocaleString("en-US")} GitHub requests` } : {});
    const files = again?.files ?? (await github.files(ref, pr.changedFiles));
    lastRead = { key, pr, files };
    progress("pr", "done");
    progress("files", "active", { label: `Reading ${plural(pr.changedFiles, "changed file")}` });
    const { review, plan } = await parser.analyse(pr, files, (state, words) => progress("parser", state, words));
    progress("files", "done");
    lastRead = null;
    await store.saveReview(key, review);
    return { review, plan };
};

/**
 * The board's elements in `theme`, for one `add-drawdy-elements` call: with
 * its PR card's top-left corner at `pr`, or in free space near the camera.
 */
export const layOut = async (deps: { ddp: Ddp; generateId: () => string }, review: Review, theme: Theme, plan: BoardPlan = planBoard(review), pr?: Point): Promise<DrawdyElementSchema[]> => {
    const { ddp, generateId } = deps;
    const at = async (): Promise<Point> => {
        const card = plan.pins.get("pr");
        if (pr && card) return { x: plan.bounds.x + pr.x - card.x, y: plan.bounds.y + pr.y - card.y };
        const view = await viewportOf(ddp);
        const wanted = view
            ? { x: Math.round(view.x + view.width * 0.06), y: Math.round(view.y + view.height * 0.08), width: plan.bounds.width, height: plan.bounds.height }
            : { ...plan.bounds, x: 0, y: 0 };
        return findFreeSpot(ddp, wanted);
    };
    return reviewElements(review, shiftPlan(plan, await at()), generateId, theme).elements;
};
