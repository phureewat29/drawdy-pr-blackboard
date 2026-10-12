/**
 * A PR turned into an investigation board: the pieces of evidence (pins) and
 * the links between them.
 *
 * Each pin is a card: the PR, a changed declaration, the unchanged caller of
 * a thread's entry, a test file, or a file with no readable declarations.
 * Changed declarations joined by links form threads, each laid out as a band;
 * changes that join no thread go to the bottom row. The steps walk the pins
 * in board order, which the layout decides, so `buildReview` plans the board
 * once to fix it.
 *
 * A link is a fact: every link comes from a reference a language's linker
 * resolved (`linking.ts`): the innermost card holding the reference, to the
 * card standing for what it names. Languages with no linker keep the line
 * patterns of `symbols.ts` for their cards, and draw no strings.
 */

import type { Hunk } from "./diff.ts";
import type { FileStatus, PrFile, PrInfo } from "./github.ts";
import type { Facts, Ref, Unit } from "./langs/pack.ts";
import { planBoard, type BoardPlan } from "./layout.ts";
import type { FileRole, Language } from "./language.ts";
import { linkAll } from "./linking.ts";
import { fileBoard, symbolBoard, type BoardContext } from "./model/cards.ts";
import { reviewFiles } from "./model/changes.ts";
import { limit, unpinnedOf } from "./model/limit.ts";
import { linksOf } from "./model/links.ts";
import { place } from "./model/place.ts";
import { readSources, type Parse, type Read } from "./sources.ts";
import { labelOf, type ChangedSymbol, type LooseChange, type TestCase } from "./symbols.ts";

export { LIMITS } from "./model/limit.ts";

export type ReviewFile = {
    path: string;
    previousPath?: string;
    status: FileStatus;
    role: FileRole;
    lang: Language;
    additions: number;
    deletions: number;
    hunks: Hunk[];
    /** False when GitHub left the diff out. */
    hasPatch: boolean;
    symbols: ChangedSymbol[];
    loose: LooseChange[];
    cases: TestCase[];
};

export type PinKind = "pr" | "change" | "context" | "test" | "file";
export type PinStatus = "new" | "changed" | "unchanged";
/**
 * Where a pin sits: in a thread's flow, in the row under it (the thread's
 * tests, and file cards whose every link goes into it), or in the bottom row.
 */
export type Lane = "flow" | "under" | "rest";

export type Pin = {
    id: string;
    kind: PinKind;
    /** What the card is called: `#dispatch()`, `hono-base.ts imports`, `compose.test.ts`. */
    name: string;
    path?: string;
    symbol?: ChangedSymbol;
    /** The head lines the card covers. */
    from: number;
    to: number;
    /** The band it belongs to; the bottom row counts as the band after the last. */
    band: number;
    lane: Lane;
    /** Column within its band: callers left, what they call right. */
    column: number;
    status: PinStatus;
    add: number;
    del: number;
    /** Head lines `from`..`to`, for change and context cards. */
    head?: string[];
    /** A file card about only some of a file's changes: these head ranges. */
    ranges?: { from: number; to: number }[];
};

export type LinkKind = "calls" | "uses" | "context" | "tests" | "imports";

export type Link = {
    id: string;
    from: string;
    to: string;
    kind: LinkKind;
    /** How a context link reads: `calls` when one of its references is a call, else `uses`. */
    reads?: "calls" | "uses";
    /** Head line in `from` where the string starts. */
    at?: number;
    /** The head lines in `from` that make the link: its calls for `calls`, else every reference. */
    rows: number[];
};

/** A thread of changed declarations joined by links, with its tests: one band of the board. */
export type Band = {
    /** The changed declarations nothing else in the thread links to. */
    entries: string[];
};

export type Review = {
    pr: PrInfo;
    files: ReviewFile[];
    /** Declarations when PR Blackboard could read them, otherwise whole files. */
    mode: "symbols" | "files";
    pins: Pin[];
    links: Link[];
    bands: Band[];
    /** Every pin by id in board order: left to right along each band, the row under it, then the bottom row. */
    order: string[];
    /**
     * What the card limit left off: changed declarations with no card, and
     * changed files with no card whose declarations aren't counted already.
     */
    unpinned: { functions: number; files: number };
};

/** A board's cards, bands and links, before its review is whole. */
export type Board = Pick<Review, "mode" | "pins" | "links" | "bands">;

/**
 * What the read tier gave: every text read, the parsed files' facts, the
 * references that resolved, and the card names the linkers give their units
 * (`Server.Start()`), which `labelOf` gives the rest.
 */
export type Analysed = { texts: ReadonlyMap<string, string>; facts: ReadonlyMap<string, Facts>; refs: readonly Ref[]; labels: ReadonlyMap<string, string> };

/** A review and its board's plan, which fixes the review's order. */
export type Built = { review: Review; plan: BoardPlan };

/** Reads what a PR's board needs and resolves its references: what `buildReview` builds the review from. */
export const readAndLink = async (pr: PrInfo, files: readonly PrFile[], read: Read, parse: Parse): Promise<Analysed> => {
    const sources = await readSources(files, read, parse);
    const changed = new Set(files.filter((f) => f.status !== "removed").map((f) => f.path));
    const refs = linkAll(pr, changed, sources);
    const labels = new Map([...sources.facts.values()].flatMap((f) => (f.labels ? [...f.labels] : [])));
    return { texts: sources.texts, facts: sources.facts, refs, labels };
};

/**
 * Reads what the board needs, resolves its references and builds the review:
 * the one path from a PR's files to its board, for the parser worker, the
 * tests and the score gate alike.
 */
export const analyse = async (pr: PrInfo, files: readonly PrFile[], read: Read, parse: Parse): Promise<Built> => buildReview(pr, files, await readAndLink(pr, files, read, parse));

export const buildReview = (pr: PrInfo, prFiles: readonly PrFile[], analysed: Analysed): Built => {
    const heads = new Map([...analysed.texts].map(([path, text]) => [path, text.split("\n")]));
    const nameOf = (u: Unit) => analysed.labels.get(u.id) ?? labelOf(u);
    const { files, units } = reviewFiles(prFiles, analysed, heads, nameOf);
    const context: BoardContext = { files, heads, facts: analysed.facts, refs: analysed.refs, units, nameOf };
    const draft = files.flatMap((f) => f.symbols).length >= 2 ? symbolBoard(context) : fileBoard(context);
    // Which cards a full board keeps depends on where tests hang, so links are found once on every card, then again on those kept.
    const limited = limit(place({ ...draft, links: linksOf(draft.pins, context) }), files);
    const board = place({ ...limited, links: linksOf(limited.pins, context) });
    const review: Review = { pr, files, ...board, order: [], unpinned: unpinnedOf(board, files) };
    const plan = planBoard(review);
    return { review: { ...review, order: plan.order }, plan };
};

/**
 * What the driver gets and keeps: a file with no card keeps its name, role
 * and counts, not its diff, which for Bun's 2,188-file rewrite would cross as
 * 84 MB.
 */
export const compact = (review: Review): Review => {
    const carded = new Set(review.pins.map((p) => p.path));
    return { ...review, files: review.files.map((f) => (carded.has(f.path) ? f : { ...f, hunks: [], symbols: [], loose: [], cases: [] })) };
};
