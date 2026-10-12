/**
 * Messages between the driver (Drawdy's shared host worker) and PR Blackboard's panel webview. The driver owns all
 * state and sends the panel a whole view each time it changes; the panel sends back what the reader asked for, which
 * the driver checks with `webviewToDriver` before acting on it.
 */

import * as g from "../lib/guard.ts";
import type { PrState } from "../lib/github.ts";
import type { Segment } from "../lib/markdown.ts";

/** How far a loading step, or a row under one, has got. */
export type StepState = "todo" | "active" | "done" | "warning" | "failed";

/** A row under a loading step: one language's parser (`Rust`), or a changed file by its path (`file`). */
export type StepRow = { label: string; state: StepState; file?: true };

/**
 * A loading step, as a CI job lists it: its words and a muted note after them (`23 GitHub requests`), how far it is,
 * and at its right a count while it runs (`12 / 40`) or the time it took (`1.2 s`). While it runs it lists its
 * rows: at most 10, then how many more there are.
 */
export type LoadStep = { key: string; label: string; note?: string; state: StepState; meta?: string; rows?: StepRow[]; more?: number };

/** A note on a PR, as a CI annotation: a warning says what the board can't show; a failure, why an open failed. */
export type Annotation = { level: "warning" | "failure"; title: string; detail: string };

/** One kind of the current card's links, `called by`, and the cards it names, each with its string's colour, null when it has no string. */
export type LinkKindRow = { word: string; chips: { link: string; name: string; colour: number | null }[] };

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

/** The PR card: who opened it and how big it is, what the board can't show, and the whole description as HTML. */
export type PrCardView = { pin: "pr"; about: string[]; warnings: Annotation[]; description: string | null };

export type CurrentCard = CodeCard | PrCardView;

export type PanelView = {
    phase: "start" | "loading" | "ready";
    loading: LoadStep[];
    /** The loading view's warnings so far, and why the open failed when it did. */
    annotations: Annotation[];
    /** Why the last action failed, in words: under the field, or on the toolbar's line. */
    error: string | null;
    /** The PR being read or loaded: its `owner/repo#number` and its project's tag colour, if it has one. */
    tag: { label: string; colour: string | null } | null;
    /** The PR being read: its title split on backticks, and its lines added and deleted as GitHub counts them. */
    pr: { title: Segment[]; state: PrState; additions: number; deletions: number } | null;
    /** How many steps the board has: its code cards, not the PR card or unchanged context. */
    total: number;
    /** The current card's step, or -1: none yet, the PR card, or an unchanged card, which are not steps. */
    current: number;
    hasPrevious: boolean;
    hasNext: boolean;
    card: CurrentCard | null;
    /** What rebuilding the board costs, when more than the usual 2 GitHub requests: the panel asks first. */
    rebuildCost: { files: number; requests: number } | null;
    /** The step a rebuild has reached, in the loading view's words, while one runs. */
    rebuilding: string | null;
};

export type DriverToWebview = { type: "theme"; css: string } | { type: "view"; view: PanelView };

export const webviewToDriver = g.union(
    g.object({ type: g.literal("ready") }),
    g.object({ type: g.literal("open"), url: g.string }),
    /** Home: back to the start view. The board stays, and a click on one of its cards reads it again. */
    g.object({ type: g.literal("start") }),
    g.object({ type: g.literal("next") }),
    g.object({ type: g.literal("previous") }),
    g.object({ type: g.literal("overview") }),
    /** The PR card current, and the camera on it. */
    g.object({ type: g.literal("description") }),
    /** Follow one of the current card's links to its far card. */
    g.object({ type: g.literal("follow"), link: g.string }),
    g.object({ type: g.literal("read-all") }),
    /** Build the board again from GitHub, in the old one's place. */
    g.object({ type: g.literal("rebuild") }),
    /** Close Read all: Esc while the panel has focus. */
    g.object({ type: g.literal("close") })
);
export type WebviewToDriver = g.Infer<typeof webviewToDriver>;
