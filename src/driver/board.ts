/** PR Blackboard's elements on the board, read from their marks: by PR, as an index of one board, and as clicked. */

import type { Fold, Theme } from "../lib/card.ts";
import { catmullRomSpline } from "../lib/curve.ts";
import type { Point, Rect } from "../lib/layout.ts";
import type { LinkKind } from "../lib/model.ts";
import type { Ddp } from "./ddp.ts";
import { markOf, type BoardMark } from "./elements.ts";

export type Marked = { id: string; mark: BoardMark };

export type Clicked = Marked & { rect: Rect; path: Point[] | null };

/** What a PR Blackboard element stands for, when someone clicks it. */
export type Target = { kind: "pin"; pin: string } | { kind: "label" | "link"; link: string };

export type IndexPin = { id: string; name: string; width: number; height: number; folds: Fold[] };

export type IndexLink = { id: string; kind: LinkKind; from: string; to: string; colour: number | null };

/** A board, by its PR and head commit. */
export type BoardRef = { key: string; sha: string };

/** A PR's board, from its elements' marks alone. */
export type Index = BoardRef & {
    /** Each card by pin id. */
    pins: Map<string, IndexPin>;
    /** Each drawn string by link id, its colour an index into `STRING_COLOURS`. */
    links: Map<string, IndexLink>;
    labels: Map<string, string>;
    targets: Map<string, Target>;
    /** The theme the cards were pinned in, from the PR card's mark; null when that card is gone. */
    theme: Theme | null;
};

/** The index of one PR's board at one head commit, from the marks on the board. */
export const indexOf = (key: string, sha: string, elements: readonly Marked[]): Index => {
    const pins = new Map<string, IndexPin>();
    const links = new Map<string, IndexLink>();
    const labels = new Map<string, string>();
    const targets = new Map<string, Target>();
    let theme: Theme | null = null;
    for (const { id, mark } of elements) {
        if (mark.pr !== key || mark.sha !== sha) continue;
        if ((mark.part === "pr" || mark.part === "pin") && mark.pin) {
            // Two boards stacked at one commit (a reload mid-rebuild): the later card, the newer board's, wins, as its strings and labels do.
            pins.set(mark.pin, { id, name: mark.name ?? mark.pin, width: mark.width ?? 0, height: mark.height ?? 0, folds: mark.folds ?? [] });
            if (mark.part === "pr" && mark.theme) theme = mark.theme;
            targets.set(id, { kind: "pin", pin: mark.pin });
        } else if (mark.part === "link" && mark.link && mark.kind && mark.from && mark.to) {
            links.set(mark.link, { id, kind: mark.kind, from: mark.from, to: mark.to, colour: mark.colour ?? null });
            targets.set(id, { kind: "link", link: mark.link });
        } else if (mark.part === "label" && mark.link) {
            labels.set(mark.link, id);
            targets.set(id, { kind: "label", link: mark.link });
        }
    }
    return { key, sha, pins, links, labels, targets, theme };
};

/** Every PR Blackboard element on the board, grouped by PR, each group in Drawdy's scene order. */
export const readBoard = async (ddp: Ddp): Promise<Map<string, Marked[]>> => {
    const { drawdyElements } = await ddp.call("command:scene:get-drawdy-elements", { properties: ["meta"] });
    const byPr = new Map<string, Marked[]>();
    for (const e of drawdyElements) {
        const mark = markOf(e.meta);
        if (mark) byPr.set(mark.pr, [...(byPr.get(mark.pr) ?? []), { id: e.id, mark }]);
    }
    return byPr;
};

/** Every PR Blackboard element of one PR's boards. */
export const readBoardOf = async (ddp: Ddp, key: string): Promise<Marked[]> => (await readBoard(ddp)).get(key) ?? [];

/**
 * The one read a click costs: the clicked elements with their marks, where they are now, and, for a string, the
 * curve it draws. Elements that aren't PR Blackboard's are left out.
 */
export const readClicked = async (ddp: Ddp, ids: readonly string[]): Promise<Clicked[]> => {
    if (ids.length === 0) return [];
    const found = await ddp.tryCall("command:scene:get-drawdy-elements", {
        properties: ["meta", "x", "y", "width", "height", "points"],
        drawdyElementIds: [...ids],
    });
    return (found?.drawdyElements ?? []).flatMap((e): Clicked[] => {
        const mark = markOf(e.meta);
        if (!mark || e.x === undefined || e.y === undefined) return [];
        return [{ id: e.id, mark, rect: { x: e.x, y: e.y, width: e.width ?? 0, height: e.height ?? 0 }, path: e.points ? curveOf(e.points) : null }];
    });
};

/** Where elements are now: people move cards around. Missing ids are left out. */
export const rectsOf = async (ddp: Ddp, ids: readonly string[]): Promise<Map<string, Rect>> => {
    if (ids.length === 0) return new Map();
    const found = await ddp.tryCall("command:scene:element-rects", { drawdyElementIds: [...ids] });
    return new Map((found?.rects ?? []).map((r) => [r.drawdyElementId, r.rect]));
};

/** The curve a string draws: Drawdy keeps its points as `[start, end, ...bend]` and draws a spline through `[start, ...bend, end]`. */
const curveOf = (points: readonly (readonly [number, number])[]): Point[] | null => {
    if (points.length < 2) return null;
    const [start, end, ...bend] = points.map(([x, y]) => ({ x, y }));
    return catmullRomSpline([start, ...bend, end], 20);
};

/** Whether a PR's board for this head commit is on the board already. */
export const pinnedAt = (elements: readonly Marked[], sha: string): boolean => elements.some((e) => e.mark.sha === sha && e.mark.part === "pr");
