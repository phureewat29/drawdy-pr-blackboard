/**
 * Messages between the driver (Drawdy's shared host worker) and PR Blackboard's
 * panel webview. The driver owns all state and sends the panel a full view
 * each time it changes; the panel sends back what the user asked for.
 *
 * Messages from the webview are checked at runtime with `webviewToDriver`
 * before the driver acts on them.
 */

import * as g from "../lib/guard.ts";
import type { PrState } from "../lib/github.ts";
import type { Segment } from "../lib/markdown.ts";

/** A loading step: its words, a muted note after them (`first time only`), and how far it is. */
export type LoadStep = { label: string; note?: string; state: "done" | "active" | "todo" };

/**
 * One kind of the current card's links, `called by`, and the cards it names,
 * each with its string's colour as an index into `STRING_COLOURS`, or null
 * when the link has no string on the board.
 */
export type LinkKindRow = { word: string; chips: { link: string; name: string; colour: number | null }[] };

/** A code card: its name, chip, where it is and its links. */
export type CodeCard = {
    pin: string;
    name: string;
    /** The card's chip, as on the board: changed code has none. */
    status: "NEW" | "UNCHANGED" | "TESTS" | null;
    /** `src/hono-base.ts · 411–471`. */
    where: string;
    links: LinkKindRow[];
    /** Whether Read all shows more: the card ends in a row that says `Read all` on the board. */
    canReadAll: boolean;
};

/** The PR card: who opened it and how big it is, what the board leaves off, and the whole description as HTML, or null when there is none. */
export type PrCardView = { pin: "pr"; about: string[]; description: string | null };

export type CurrentCard = CodeCard | PrCardView;

export type PanelView = {
    phase: "start" | "loading" | "ready";
    loading: LoadStep[];
    /** Why the last attempt failed, in words for the reader, shown in the view on screen: under the field, or on the toolbar's line. */
    error: string | null;
    /** The pull request being read, or loaded: its `owner/repo#number` and its project's tag colour, if it has one. */
    tag: { label: string; colour: string | null } | null;
    /** The pull request being read, with its lines added and deleted in all, as GitHub counts them; the title split on backticks. */
    pr: { title: Segment[]; state: PrState; additions: number; deletions: number } | null;
    /** How many steps the board has: its code cards, not the PR card or unchanged context. */
    total: number;
    /** The current card's step, or -1: none yet, the PR card, or an unchanged card, which are not steps. */
    current: number;
    /** Whether Previous and Next have a step to go to: the panel disables Previous and Next from these alone. */
    hasPrevious: boolean;
    hasNext: boolean;
    card: CurrentCard | null;
    /** What rebuilding the board being read costs, when that is more than the usual 2 GitHub requests: the panel asks first. */
    rebuildCost: { files: number; requests: number } | null;
    /** The step a rebuild has reached, in the loading view's words, while one runs. */
    rebuilding: string | null;
};

export type DriverToWebview = { type: "theme"; css: string } | { type: "view"; view: PanelView };

export const webviewToDriver = g.union(
    g.object({ type: g.literal("ready") }),
    g.object({ type: g.literal("open"), url: g.string }),
    /** Home: back to the start view. The board stays where it is, and a click on one of its cards reads it again. */
    g.object({ type: g.literal("start") }),
    g.object({ type: g.literal("next") }),
    g.object({ type: g.literal("previous") }),
    g.object({ type: g.literal("overview") }),
    /** The PR card current, and the camera on it. */
    g.object({ type: g.literal("description") }),
    /** Follow one of the current card's links to its far card. */
    g.object({ type: g.literal("follow"), link: g.string }),
    g.object({ type: g.literal("read-all") }),
    /** Build the board being read again from GitHub, in the old one's place. */
    g.object({ type: g.literal("rebuild") }),
    /** Close Read all: Esc while the panel has focus. */
    g.object({ type: g.literal("close") })
);
export type WebviewToDriver = g.Infer<typeof webviewToDriver>;
