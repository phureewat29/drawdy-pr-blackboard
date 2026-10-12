/**
 * The shapes strings take: the bend points of each route, the curve Drawdy
 * draws through them, and what a curve must not do.
 */

import { catmullRomSpline, crossings, nearRun, smoothstep } from "../curve.ts";
import { clamp } from "../fp.ts";
import { LAYOUT } from "./constants.ts";
import { bottom, right, type Point, type Rect } from "./geometry.ts";

/** R1 across, R1' detour, R2 up or down, R3 flat leftward in the bottom row, R4 back over (or under) both cards. */
export type Route = "R1" | "R1'" | "R2" | "R3" | "R4";

/** A column R1' runs through, `lo` to `hi` in x, along its lane at `y`. */
export type ColumnLane = { lo: number; hi: number; y: number };

/** Points Drawdy draws for each stretch of a string's curve between two of its points. */
export const SPLINE_STEPS = 20;
const STAGES = [0.25, 0.5, 0.75];

const linear = (s: number) => s;

/** Even steps along x, `ease`d along y, hanging at the middle like string pinned at both ends (`LAYOUT.sag`). */
const hanging = (a: Point, b: Point, ease: (s: number) => number): Point[] => {
    const d = { x: b.x - a.x, y: b.y - a.y };
    const { share, min, max } = LAYOUT.sag;
    const sag = clamp(Math.hypot(d.x, d.y) * share, min, max);
    return STAGES.map((s) => ({ x: a.x + d.x * s, y: a.y + d.y * ease(s) + sag * 4 * s * (1 - s) }));
};

/** R1 and R3: strings that share an end meet at their own angles. */
export const acrossBends = (a: Point, b: Point): Point[] => hanging(a, b, linear);

/** R1 leaving and arriving level, for a string that must clear the corner of a card beside an end or would climb a card's side: level, it climbs mid-gap. */
export const levelBends = (a: Point, b: Point): Point[] => hanging(a, b, smoothstep);

/** R2: even steps along y, a smoothstep in x. */
export const upBends = (a: Point, b: Point): Point[] => STAGES.map((s) => ({ x: a.x + (b.x - a.x) * smoothstep(s), y: a.y + (b.y - a.y) * s }));

/** R4: over both cards (`side` -1) or under them (1), `edge` being their top or bottom. */
export const backBends = (a: Point, b: Point, edge: number, side: -1 | 1): Point[] => {
    const inward = (b.x - a.x) / 8;
    return [
        { x: a.x + inward, y: edge + side * LAYOUT.back.lead },
        { x: (a.x + b.x) / 2, y: edge + side * LAYOUT.back.top },
        { x: b.x - inward, y: edge + side * LAYOUT.back.lead },
    ];
};

/** How far apart the points of an R1' course are, in x. */
const COURSE_STEP = 4;

/**
 * The course of an R1' string: level along its lane through each column,
 * easing between columns on a smoothstep, which never overshoots; straight
 * from the source and into the target, so strings sharing an end meet at
 * their own angles.
 */
const courseThrough = (a: Point, b: Point, columns: readonly ColumnLane[]): Point[] => {
    const course: Point[] = [a];
    const leg = (p: Point, q: Point, ease: (s: number) => number) => {
        for (let x = p.x + COURSE_STEP; x < q.x; x += COURSE_STEP) {
            const s = (x - p.x) / (q.x - p.x);
            course.push({ x, y: p.y + (q.y - p.y) * ease(s) });
        }
        course.push(q);
    };
    let at = a;
    columns.forEach((c, i) => {
        leg(at, { x: c.lo - LAYOUT.detour.margin, y: c.y }, i > 0 ? smoothstep : linear);
        at = { x: c.hi + LAYOUT.detour.margin, y: c.y };
        course.push(at);
    });
    leg(at, b, linear);
    return course;
};

/** `count` points evenly spaced along a polyline `length` long, its ends left out. */
const evenlyAlong = (path: readonly Point[], length: number, count: number): Point[] => {
    const along = (k: number) => (k * length) / (count + 1);
    const points: Point[] = [];
    let walked = 0;
    for (let i = 1, k = 1; i < path.length && k <= count; i++) {
        const [p, q] = [path[i - 1], path[i]];
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        while (k <= count && walked + d >= along(k)) {
            const t = (along(k) - walked) / (d || 1);
            points.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
            k++;
        }
        walked += d;
    }
    return points;
};

/** R1' bends, one every `detour.step` along its course: Drawdy's curve through points that close together follows it. */
export const throughBends = (a: Point, b: Point, columns: readonly ColumnLane[]): Point[] => {
    const course = courseThrough(a, b, columns);
    const length = course.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - course[i].x, p.y - course[i].y), 0);
    return evenlyAlong(course, length, Math.max(3, Math.round(length / LAYOUT.detour.step) - 1));
};

/** The curve Drawdy draws through a string's ends and bends. */
export const stringPath = (start: Point, bend: readonly Point[], end: Point): Point[] => catmullRomSpline([start, ...bend, end], SPLINE_STEPS);

/** Whether a curve runs more than 2 past either of its ends along its route's axis, vertical for R2: a hook. */
export const hooks = (route: Route, path: readonly Point[], start: Point, end: Point): boolean => {
    const axis = route === "R2" ? "y" : "x";
    const lo = Math.min(start[axis], end[axis]) - 2;
    const hi = Math.max(start[axis], end[axis]) + 2;
    return path.some((p) => p[axis] < lo || p[axis] > hi);
};

/** Whether a curve runs along one of a card's edges closely and long enough to read as its border (`LAYOUT.hug`). */
export const hugs = (path: readonly Point[], r: Rect): boolean => {
    const [tl, tr, br, bl] = [
        { x: r.x, y: r.y },
        { x: right(r), y: r.y },
        { x: right(r), y: bottom(r) },
        { x: r.x, y: bottom(r) },
    ];
    return [[tl, bl], [tr, br], [tl, tr], [bl, br]].some((edge) => nearRun(path, edge, LAYOUT.hug.near) >= LAYOUT.hug.run);
};

type Curve = { start: Point; end: Point; path: readonly Point[] };

const samePoint = (p: Point, q: Point) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;

/** The ends of `a` that are ends of `b` too, where the two meet. */
export const sharedEnds = (a: Curve, b: Curve): Point[] => [a.start, a.end].filter((p) => samePoint(p, b.start) || samePoint(p, b.end));

/** How near a shared end a crossing is a meeting instead, as strings into one point meet. */
const MEET = 24;

/** How often two strings cross between their ends. */
export const stringCrossings = (a: Curve, b: Curve): number => crossings(a.path, b.path, sharedEnds(a, b), MEET);

/** How often `items` cross among themselves, each pair counted once. */
export const crossingsAmong = <T>(items: readonly T[], cross: (a: T, b: T) => number): number =>
    items.reduce((n, a, i) => n + items.slice(i + 1).reduce((m, b) => m + cross(a, b), 0), 0);
