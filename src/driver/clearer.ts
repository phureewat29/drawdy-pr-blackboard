/**
 * Clearing the board being read: its cards, lines and labels, found by their marks (its PR at its head commit), come
 * off the canvas in one removal, so one undo brings them back. The reader's own notes and strokes stay, and so does
 * this device's copy of the review, so opening the PR again is quick. Then the start view shows, as after Home.
 */

import { readBoardAt, type Sweeper } from "./board.ts";
import type { Ddp } from "./ddp.ts";
import type { Navigator } from "./navigator.ts";
import type { PanelFeed } from "./panel-feed.ts";

export type Clearer = { clear: () => Promise<void> };

export type ClearerDeps = { ddp: Ddp; guide: Navigator; panel: PanelFeed; sweeper: Sweeper };

export const createClearer = ({ ddp, guide, panel, sweeper }: ClearerDeps): Clearer => ({
    clear: async () => {
        const on = guide.board();
        // Refused while a rebuild runs, as the panel's Clear is: a new board would land after the old one went.
        if (!on || panel.rebuilding) return panel.push();
        await guide.closePopover();
        await sweeper.remove((await readBoardAt(ddp, on)).map((e) => e.id));
        guide.set(null);
        panel.phase = "start";
        panel.error = null;
        panel.push();
    },
});
