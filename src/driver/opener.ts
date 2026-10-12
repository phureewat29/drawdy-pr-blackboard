/**
 * Bringing a board's review to the panel: opening a PR from its link, which pins its board unless it is there
 * already, and picking up a board already pinned when the panel opens or the reader clicks one.
 */

import { parsePrUrl, prKey, prLabel } from "../lib/github.ts";
import type { Review } from "../lib/model.ts";
import { indexOf, pinnedAt, readBoard, readBoardOf, rectsOf, type Index, type Marked } from "./board.ts";
import { viewportOf } from "./camera.ts";
import type { Channel } from "./channel.ts";
import type { Ddp } from "./ddp.ts";
import type { Navigator } from "./navigator.ts";
import { loadReview, pinBoard, reviewAt, type Loaders, type Pinning } from "./open.ts";
import type { PanelFeed } from "./panel-feed.ts";
import { createJob, type Job } from "./progress.ts";
import { cardLimit, listCut, noDiff } from "./warnings.ts";
import { explain } from "./words.ts";

const NOT_A_PR = "Only GitHub PR links work, like github.com/owner/repo/pull/123.";

export type Opener = {
    /**
     * Opens a PR: one add call for the whole board (one undo step), then one flight to the overview with the PR card
     * current. A link that isn't a PR stays in the start view, with why under the field; a failure on the way stays
     * in the loading view, at its failed step.
     */
    openPr: (url: string) => Promise<void>;
    /** Opens the panel on the board being read, or picks one up. */
    openPanel: () => Promise<void>;
    /** With the panel open, a click that moved the reader to another board loads that board's review for it. */
    followBoard: () => Promise<void>;
};

export type OpenerDeps = { ddp: Ddp; channel: Channel; guide: Navigator; panel: PanelFeed; loaders: Loaders; pinning: Pinning };

/** Warnings a built review gives its open: the files past GitHub's list, the diffs GitHub left out, and the card limit. */
const warnBuilt = (job: Job, review: Review) => {
    job.warn("pr", listCut(review));
    job.warn("files", noDiff(review));
    job.warn("pin", cardLimit(review.unpinned));
};

export const createOpener = ({ ddp, channel, guide, panel, loaders, pinning }: OpenerDeps): Opener => {
    /** `reviewAt` for the panel: the loading view shows while GitHub is read, and stays when that fails. The caller sets the phase after a success. */
    const reviewForPanel = async (key: string, sha: string): Promise<Review> => {
        const job = (panel.job = createJob());
        panel.opening = key;
        try {
            const review = await reviewAt(loaders, key, sha, panel.loadingProgress(job, () => (panel.phase = "loading")));
            if (panel.phase === "loading") panel.unread.set(review, job.unread());
            panel.phase = "start";
            return review;
        } catch (err) {
            if (panel.phase === "loading" && panel.job === job) panel.fail(job, err);
            throw err;
        }
    };

    /** Of the boards on the canvas, the one whose PR card is nearest the middle of the view. */
    const nearest = async (boards: Map<string, Marked[]>): Promise<string> => {
        const cards = [...boards].flatMap(([key, elements]) => elements.filter((e) => e.mark.part === "pr").map((e) => ({ key, id: e.id })));
        const [rects, view] = await Promise.all([rectsOf(ddp, cards.map((c) => c.id)), viewportOf(ddp)]);
        const cx = view ? view.x + view.width / 2 : 0;
        const cy = view ? view.y + view.height / 2 : 0;
        const distance = (id: string) => {
            const r = rects.get(id);
            return r ? Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy) : Infinity;
        };
        return cards.sort((a, b) => distance(a.id) - distance(b.id))[0]?.key ?? [...boards.keys()][0];
    };

    /**
     * Picks up a board already pinned: the one the reader is on (the last card they clicked), else the one nearest the
     * middle of the screen. The PR card is current unless they clicked another card, and the camera stays where it is.
     * Rejects, in words, when the review can't be had.
     */
    const pickUp = async (): Promise<void> => {
        const boards = await readBoard(ddp);
        if (boards.size === 0) return;
        const on = guide.board();
        const key = on && boards.has(on.key) ? on.key : await nearest(boards);
        const elements = boards.get(key) ?? [];
        // A reload between a rebuild's add and its removal leaves two boards of one PR: the newest, last in Drawdy's scene order, is the one to read.
        const sha = on?.key === key ? on.sha : (elements.findLast((e) => e.mark.part === "pr")?.mark.sha ?? elements.at(-1)?.mark.sha);
        if (!sha) return;
        const review = await reviewForPanel(key, sha);
        const was = on?.key === key && on.sha === sha ? guide.currentPin() : null;
        guide.set(indexOf(key, sha, elements), review);
        panel.phase = "ready";
        await guide.focus(was ?? "pr");
    };

    const openPanel = async () => {
        await channel.open();
        if (guide.review()) panel.phase = "ready";
        // The board is on the canvas but can't be picked up: the loading view says why, or the start view when it never showed.
        else
            await pickUp().catch((err: unknown) => {
                console.warn("[pr-blackboard] could not pick up the board", err);
                if (panel.phase !== "loading") panel.error = explain(err);
            });
        panel.push();
    };

    const land = async (index: Index, review: Review) => {
        guide.set(index, review);
        panel.phase = "ready";
        await guide.land();
    };

    const openPr = async (url: string) => {
        const ref = parsePrUrl(url);
        if (!ref) {
            panel.phase = "start";
            panel.error = NOT_A_PR;
            return panel.push();
        }
        const key = prKey(ref);
        panel.error = null;
        panel.phase = "loading";
        const job = (panel.job = createJob());
        panel.opening = prLabel(ref);
        const progress = panel.loadingProgress(job);
        progress.step("pr", "active");
        try {
            // The board being rebuilt opens once the rebuild has landed: two boards of one PR at once would be one board of twice the cards.
            if (panel.rebuilding?.key === key) await panel.rebuilding.done;
            const { review, plan } = await loadReview(loaders, ref, progress);
            if (plan) panel.unread.set(review, job.unread());
            warnBuilt(job, review);
            const onBoard = await readBoardOf(ddp, key);
            if (pinnedAt(onBoard, review.pr.headSha)) {
                await land(indexOf(key, review.pr.headSha, onBoard), review);
                return;
            }
            await pinBoard(pinning, review, plan, progress);
            job.step("pin", "done");
            await land(indexOf(key, review.pr.headSha, await readBoardOf(ddp, key)), review);
        } catch (err) {
            panel.fail(job, err);
        }
    };

    const followBoard = async () => {
        const on = guide.board();
        if (!channel.isReady() || !on || guide.review()) return;
        guide.attach(await reviewForPanel(on.key, on.sha));
        // The panel names each link in its string's colour, which the board's marks hold.
        await guide.readMarks();
        panel.phase = "ready";
        panel.push();
    };

    return { openPr, openPanel, followBoard };
};
