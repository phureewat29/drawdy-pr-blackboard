/** Opening a pull request: fetch it, build the review, and pin it to the board. */

import type { DrawdyElementSchema } from "@drawdy/driver-protocol";
import { plural } from "../lib/fp.ts";
import { pageCount, prKey, type Github, type PrFile, type PrInfo, type PrRef } from "../lib/github.ts";
import type { Theme } from "../lib/card.ts";
import { planBoard, shiftPlan } from "../lib/layout.ts";
import { analyse, type Review } from "../lib/model.ts";
import { changedSources } from "../lib/sources.ts";
import { grammarOf, type Grammar } from "../lib/syntax.ts";
import { viewportOf } from "./camera.ts";
import type { Ddp } from "./ddp.ts";
import { reviewElements } from "./elements.ts";
import { languagesOf, type Parser } from "./grammars.ts";
import { findFreeSpot } from "./space.ts";
import type { Store } from "./store.ts";

/** The loading view's steps; the parser's shows only while it downloads, beside the files'. */
export type LoadStep = "pr" | "parser" | "files" | "pin";

/** A step under way or done, renamed to `label` and given a muted `note` when they are known. */
export type Progress = (step: LoadStep, state: "active" | "done", words?: { label?: string; note?: string }) => void;

/**
 * The pull request and file list last read in this session, so a retry
 * after the parser failed costs no GitHub request.
 */
let lastRead: { key: string; pr: PrInfo; files: PrFile[] } | null = null;

/** The review for a pull request's current head: from this device's copy when it has one. */
export const loadReview = async (deps: { github: Github; store: Store; parser: Parser }, ref: PrRef, progress: Progress): Promise<Review> => {
    const { github, store, parser } = deps;
    const key = prKey(ref);
    progress("pr", "active");
    const again = lastRead?.key === key ? lastRead : null;
    const pr = again?.pr ?? (await github.pr(ref));
    if (!again) {
        const kept = await store.review(key, pr.headSha);
        if (kept) return kept;
    }
    const pages = pageCount(pr.changedFiles);
    progress("pr", "active", pages > 1 ? { note: `${(1 + pages).toLocaleString("en-US")} GitHub requests` } : {});
    const files = again?.files ?? (await github.files(ref, pr.changedFiles));
    lastRead = { key, pr, files };
    progress("pr", "done");
    progress("files", "active", { label: `Reading ${plural(pr.changedFiles, "changed file")}` });
    const grammars = [...new Set(changedSources(files).map((f) => grammarOf(f.path)).filter((x): x is Grammar => x !== null))];
    const downloading = () => progress("parser", "active", { label: `Downloading the ${languagesOf(grammars).parser}`, note: "first time only" });
    // The parser loads beside the reads; its step, if it shows, is done on its own.
    const loading = parser.load(grammars, downloading).then(() => progress("parser", "done"));
    const [review] = await Promise.all([analyse(pr, files, (path) => github.raw(pr.headRepo, pr.headSha, path), parser.parse(downloading)), loading]);
    progress("files", "done");
    lastRead = null;
    await store.saveReview(key, review);
    return review;
};

/** Lays the board out in free space near the camera, in `theme`, as the elements of one `add-drawdy-elements` call. */
export const layOut = async (deps: { ddp: Ddp; generateId: () => string }, review: Review, theme: Theme): Promise<DrawdyElementSchema[]> => {
    const { ddp, generateId } = deps;
    const plan = planBoard(review);
    const view = await viewportOf(ddp);
    const wanted = view
        ? { x: Math.round(view.x + view.width * 0.06), y: Math.round(view.y + view.height * 0.08), width: plan.bounds.width, height: plan.bounds.height }
        : { ...plan.bounds, x: 0, y: 0 };
    const placed = shiftPlan(plan, await findFreeSpot(ddp, wanted));
    return reviewElements(review, placed, generateId, theme).elements;
};
