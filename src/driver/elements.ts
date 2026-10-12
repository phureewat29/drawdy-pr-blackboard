/**
 * The board elements for a review, and the mark each carries in its `meta` so PR Blackboard can find them again:
 * after a reload, on a teammate's screen, or when someone clicks one.
 */

import type { DomElementSchema, DrawdyElementSchema } from "@drawdy/driver-protocol";
import { cardHtml, foldsOf, prCardHtml, type Theme } from "../lib/card.ts";
import * as g from "../lib/guard.ts";
import { prKey } from "../lib/github.ts";
import { STRING_COLOURS, type BoardPlan, type PlannedString, type Rect } from "../lib/layout.ts";
import type { Review } from "../lib/model.ts";

export const MARK = "prBlackboard";

const PARTS = ["pr", "pin", "link", "label"] as const;

const fold = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && g.number(v[0]) && g.number(v[1]);

const boardMark = g.object({
    /** The pull request, as `owner/repo#123`. */
    pr: g.string,
    sha: g.string,
    part: g.oneOf(PARTS),
    /** The card an element belongs to, by pin id. */
    pin: g.optional(g.string),
    /** On a card: its name. */
    name: g.optional(g.string),
    /** A component's size when made: a resized card scales, it does not reflow. */
    width: g.optional(g.number),
    height: g.optional(g.number),
    /** On a code card: its fold rows, `[top, line]`, so a click on one opens Read all without the review. */
    folds: g.optional(g.arrayOf(fold)),
    /** On the PR card: the theme the cards were pinned in, so Read all matches them. */
    theme: g.optional(g.oneOf(["light", "dark"])),
    /** The link a string or label stands for, by link id; on a string, its kind and both cards. */
    link: g.optional(g.string),
    kind: g.optional(g.oneOf(["calls", "uses", "context", "tests", "imports"])),
    from: g.optional(g.string),
    to: g.optional(g.string),
    /** On a string: its colour as pinned, by index into `STRING_COLOURS`, so the panel names its link in that colour. */
    colour: g.optional(g.number),
});

export type BoardMark = g.Infer<typeof boardMark>;

/** PR Blackboard's mark on an element, from its meta. */
export const markOf = (meta: unknown): BoardMark | null =>
    g.parse(boardMark, typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>)[MARK] : undefined);

const markFor = (review: Pick<Review, "pr">, part: BoardMark["part"], extra: Partial<BoardMark> = {}): BoardMark => ({
    pr: prKey(review.pr.ref),
    sha: review.pr.headSha,
    part,
    ...extra,
});

/** A component holding a page of HTML, framed like a card; a dashed frame is drawn by the page itself. */
const componentSchema = (html: string, width: number, height: number, framed: boolean): DomElementSchema => ({
    type: "box",
    styles: {
        width: [width, "px"],
        height: [height, "px"],
        borderRadius: [12, "px"],
        overflow: "hidden",
        borderWidth: [framed ? 1 : 0, "px"],
        borderType: "solid",
        borderColor: "rgba(127, 127, 127, 0.35)",
    },
    children: [{ type: "iframe", child: { srcDoc: html }, styles: { width: [100, "%"], height: [100, "%"], borderWidth: [0, "px"] } }],
});

export type ReviewElements = {
    /** Cards first, then each string with its label: one `add-drawdy-elements` call, one undo step. */
    elements: DrawdyElementSchema[];
    pinIds: Map<string, string>;
    linkIds: Map<string, string>;
};

const point = (p: { x: number; y: number }): [number, number] => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];

/**
 * The board's elements in `theme`, the one Drawdy shows the reader who pins it. Nothing is grouped, so a click
 * selects one card. Each card's mark holds what a click needs (name, size, fold rows), and each string's its kind,
 * both cards and colour, so the board works without the review. Strings are curves through their bend points; a
 * drag moves only their ends.
 */
export const reviewElements = (review: Review, plan: BoardPlan, newId: () => string, theme: Theme): ReviewElements => {
    const pinIds = new Map([...plan.pins.keys()].map((id) => [id, newId()]));
    const linkIds = new Map(plan.strings.map((s) => [s.link, newId()]));

    const card = ([id, rect]: [string, Rect]): DrawdyElementSchema => {
        const pin = review.pins.find((p) => p.id === id)!;
        const pr = id === "pr";
        const html = pr ? prCardHtml(review, theme) : cardHtml(plan.cards.get(id)!, pin, theme);
        return {
            type: "component",
            drawdyElementId: pinIds.get(id)!,
            ...rect,
            schema: componentSchema(html, rect.width, rect.height, pin.kind !== "context"),
            meta: {
                [MARK]: markFor(review, pr ? "pr" : "pin", {
                    pin: id,
                    name: pin.name,
                    width: rect.width,
                    height: rect.height,
                    ...(pr ? { theme } : { folds: foldsOf(plan.cards.get(id)!) }),
                }),
            },
        };
    };

    const arrow = (s: PlannedString): DrawdyElementSchema => ({
        type: "arrow",
        drawdyElementId: linkIds.get(s.link)!,
        color: s.style.color,
        strokeWidth: s.style.width,
        strokeDash: s.style.dash,
        bend: s.bend.map(point),
        startBinding: { drawdyElementId: pinIds.get(s.from.pin)!, anchorX: s.from.anchorX, anchorY: s.from.anchorY },
        endBinding: { drawdyElementId: pinIds.get(s.to.pin)!, anchorX: s.to.anchorX, anchorY: s.to.anchorY },
        meta: { [MARK]: markFor(review, "link", { link: s.link, kind: s.kind, from: s.from.pin, to: s.to.pin, colour: (STRING_COLOURS as readonly string[]).indexOf(s.style.color) }) },
    });

    const label = (s: PlannedString): DrawdyElementSchema[] =>
        s.label
            ? [
                  {
                      type: "text",
                      drawdyElementId: newId(),
                      x: s.label.x,
                      y: s.label.y,
                      text: s.label.text,
                      fontSize: s.label.fontSize,
                      color: s.style.color,
                      meta: { [MARK]: markFor(review, "label", { link: s.link, pin: s.from.pin }) },
                  },
              ]
            : [];

    return { elements: [...[...plan.pins].map(card), ...plan.strings.flatMap((s) => [arrow(s), ...label(s)])], pinIds, linkIds };
};
