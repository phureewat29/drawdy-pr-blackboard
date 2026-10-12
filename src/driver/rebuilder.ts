/**
 * Rebuilding the board being read: its PR read from GitHub again, past this device's copy and the last read, and
 * laid out anew where the old PR card stands. Only then do the old board's elements go, found by their marks (this
 * PR at the board's head commit), so the reader's own notes stay. In DDP 1.3 that is two undo steps, the add and
 * then the removal. A failure leaves the old board as it was.
 *
 * One rebuild at a time: another asked for while one runs is refused. The reader may do anything meanwhile. The
 * landing and a failure's words are theirs only while they still read this board; otherwise it lands silently, and
 * opens of other PRs never wait for it.
 */

import { githubFailure, parsePrUrl, prKey, prLabel } from "../lib/github.ts";
import type { BoardPlan } from "../lib/layout.ts";
import type { Review } from "../lib/model.ts";
import { indexOf, readBoardAt, readBoardOf, rectsOf, type BoardRef, type Index, type Sweeper } from "./board.ts";
import type { Ddp } from "./ddp.ts";
import type { Navigator } from "./navigator.ts";
import { loadReview, pinBoard, type Loaders, type Pinning } from "./open.ts";
import type { PanelFeed } from "./panel-feed.ts";
import type { Rebuilding } from "./panel-view.ts";
import { createJob, type Progress } from "./progress.ts";
import { explain } from "./words.ts";

const GONE = "GitHub can't find this PR any more.";

export type Rebuilder = { rebuild: () => Promise<void> };

export type RebuilderDeps = { ddp: Ddp; guide: Navigator; panel: PanelFeed; loaders: Loaders; pinning: Pinning; sweeper: Sweeper };

export const createRebuilder = ({ ddp, guide, panel, loaders, pinning, sweeper }: RebuilderDeps): Rebuilder => {
    /** The new board where the old one's PR card stands, then the old board's elements off. */
    const replace = async (on: BoardRef, review: Review, plan: BoardPlan | null, progress: Progress): Promise<Index> => {
        const old = await readBoardAt(ddp, on);
        const card = old.find((e) => e.mark.part === "pr");
        const corner = card ? (await rectsOf(ddp, [card.id])).get(card.id) : undefined;
        await pinBoard(pinning, review, plan, progress, corner);
        await sweeper.remove(old.map((e) => e.id));
        const key = prKey(review.pr.ref);
        return indexOf(key, review.pr.headSha, await readBoardOf(ddp, key));
    };

    const rebuild = async () => {
        const on = guide.board();
        const ref = on ? parsePrUrl(on.key) : null;
        // Refused: the view goes again, so the panel's Rebuild, turned off at the press, shows what holds.
        if (!on || !ref || panel.rebuilding) return panel.push();
        let landed = () => {};
        const run: Rebuilding = { key: on.key, label: prLabel(ref), job: createJob(), done: new Promise<void>((resolve) => (landed = resolve)) };
        panel.rebuilding = run;
        panel.error = null;
        panel.push();
        const reading = () => panel.phase === "ready" && guide.board()?.key === on.key;
        const progress = panel.rebuildProgress(run.job);
        try {
            await guide.closePopover();
            const { review, plan } = await loadReview(loaders, ref, progress, true);
            panel.unread.set(review, run.job.unread());
            const next = await replace(on, review, plan, progress);
            const seen = reading();
            panel.rebuilding = null;
            // The old board is gone: whoever still holds it moves to the new one; Read all on one of its cards closes.
            if (guide.board()?.key === on.key) {
                await guide.closePopover();
                guide.set(next, review);
            }
            if (seen) await guide.land();
        } catch (err) {
            console.error("[pr-blackboard]", err);
            const why = githubFailure(err)?.kind === "not-found" ? GONE : explain(err);
            // Away from that board, the reader's line names it, until their next action.
            panel.error = reading() ? why : `${run.label} · failed: ${why}`;
        } finally {
            if (panel.rebuilding === run) panel.rebuilding = null;
            landed();
            panel.push();
        }
    };

    return { rebuild };
};
