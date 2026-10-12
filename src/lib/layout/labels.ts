/**
 * A string's label goes beside a bend between two other bends: a drag moves
 * only the string's ends, so the curve there stays as it is. Each label
 * keeps `clearance` from every card, label and other string, else its
 * string goes without.
 */

import { wordOf } from "../card/links.ts";
import { inflate, pathHits } from "../curve.ts";
import { sortBy } from "../fp.ts";
import type { Link } from "../model.ts";
import { SPLINE_STEPS } from "./bends.ts";
import { LAYOUT } from "./constants.ts";
import { overlaps, textRect, type Point, type Rect, type TextSpot } from "./geometry.ts";
import type { DrawnString } from "./strings.ts";

/** Text width in canvas units, roughly: Drawdy's handwriting face runs a little over half an em a character. */
const textWidth = (text: string, fontSize: number) => Math.ceil([...text].length * fontSize * 0.56) + 4;

/** The bends between two other bends, the middle one first, then outward: a string through columns has many. */
const innerBends = (s: DrawnString): number[] => {
    const middle = (s.bend.length - 1) / 2;
    return sortBy(
        s.bend.map((_, i) => i).filter((i) => i > 0 && i < s.bend.length - 1),
        (i) => Math.abs(i - middle)
    );
};

/** The stretch of a curve around bend `i` that lies within `lo`..`hi` along `axis`, give or take 2. */
const curveNear = (path: readonly Point[], i: number, lo: number, hi: number, axis: "x" | "y"): Point[] => {
    const inside = (k: number) => k >= 0 && k < path.length && path[k][axis] >= lo - 2 && path[k][axis] <= hi + 2;
    // The curve runs SPLINE_STEPS points from each of its points to the next: bend i is point (i + 1) × SPLINE_STEPS.
    let first = (i + 1) * SPLINE_STEPS;
    let last = first;
    while (inside(first - 1)) first--;
    while (inside(last + 1)) last++;
    return path.slice(first, last + 1);
};

/** Spots for `text` beside bend `i`: right then left of a steep stretch, above then below a flat one. */
const spotsBeside = (s: DrawnString, i: number, text: string): TextSpot[] => {
    const { size, height, flat, steep } = LAYOUT.label;
    const width = textWidth(text, size);
    const [before, bend, after] = [s.bend[i - 1], s.bend[i], s.bend[i + 1]];
    const spots: Point[] = [];
    if (Math.abs(after.y - before.y) > Math.abs(after.x - before.x)) {
        const y = bend.y - height / 2;
        const xs = curveNear(s.path, i, y, y + height, "y").map((p) => p.x);
        spots.push({ x: Math.max(bend.x, ...xs) + steep, y }, { x: Math.min(bend.x, ...xs) - steep - width, y });
    } else {
        const x = bend.x - width / 2;
        const ys = curveNear(s.path, i, x, x + width, "x").map((p) => p.y);
        spots.push({ x, y: Math.min(bend.y, ...ys) - flat - height }, { x, y: Math.max(bend.y, ...ys) + flat });
    }
    return spots.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), text, fontSize: size, width, height }));
};

/** Whether a label clears every box and every other string by `clearance`, and its own string by 2. */
const clearSpot = (t: TextSpot, own: DrawnString, others: readonly DrawnString[], boxes: readonly Rect[]): boolean => {
    const r = textRect(t);
    const padded = inflate(r, LAYOUT.clearance);
    return boxes.every((b) => !overlaps(padded, b)) && others.every((o) => !pathHits(o.path, padded)) && !pathHits(own.path, inflate(r, 2));
};

/** Each string's label, in turn, or null where none clears. */
export const labelStrings = (strings: readonly DrawnString[], links: readonly Link[], cards: readonly Rect[]): (TextSpot | null)[] => {
    const labels: TextSpot[] = [];
    return strings.map((s) => {
        const text = wordOf(links.find((l) => l.id === s.link)!);
        const boxes = [...cards, ...labels.map(textRect)];
        const others = strings.filter((o) => o !== s);
        const found = innerBends(s)
            .flatMap((i) => spotsBeside(s, i, text))
            .find((t) => clearSpot(t, s, others, boxes));
        if (!found) return null;
        labels.push(found);
        return found;
    });
};
