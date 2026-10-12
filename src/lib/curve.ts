/**
 * The geometry of a string: the curve Drawdy draws through an arrow's bend
 * points, and the distances clearance and clicks are measured by.
 */

import type { Point as P, Rect as Box } from "./layout/geometry.ts";

const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - 3 * p2 + p3 - p0) * t3);
};

/**
 * The polyline Drawdy draws for an arrow with bend points: a uniform Catmull-Rom spline through `waypoints`, `steps` points a segment.
 * A copy of the host's (packages/editor, curves/catmull.ts), so the preview, clearance and clicks see what the board shows.
 */
export const catmullRomSpline = (waypoints: readonly P[], steps = 20): P[] => {
    const n = waypoints.length;
    if (n <= 2) return waypoints.map((p) => ({ x: p.x, y: p.y }));
    const out: P[] = [];
    for (let i = 0; i < n - 1; i++) {
        const p0 = waypoints[Math.max(0, i - 1)];
        const p1 = waypoints[i];
        const p2 = waypoints[i + 1];
        const p3 = waypoints[Math.min(n - 1, i + 2)];
        for (let s = 0; s <= (i === n - 2 ? steps : steps - 1); s++) {
            const t = s / steps;
            out.push({ x: catmullRom(p0.x, p1.x, p2.x, p3.x, t), y: catmullRom(p0.y, p1.y, p2.y, p3.y, t) });
        }
    }
    return out;
};

/** 3s² − 2s³: eases in and out, and never leaves [0, 1], so bends placed on it make no hooks. */
export const smoothstep = (s: number): number => s * s * (3 - 2 * s);

/** Whether segment `a`–`b` passes through `r` (Liang–Barsky clipping). */
const segmentHits = (a: P, b: P, r: Box): boolean => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const p = [-dx, dx, -dy, dy];
    const q = [a.x - r.x, r.x + r.width - a.x, a.y - r.y, r.y + r.height - a.y];
    let t0 = 0;
    let t1 = 1;
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) {
            if (q[i] < 0) return false;
            continue;
        }
        const t = q[i] / p[i];
        if (p[i] < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
        if (t0 > t1) return false;
    }
    return true;
};

export const inflate = (r: Box, by: number): Box => ({ x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by });

/** Whether a polyline passes through `r`. */
export const pathHits = (path: readonly P[], r: Box): boolean => {
    for (let i = 1; i < path.length; i++) if (segmentHits(path[i - 1], path[i], r)) return true;
    return false;
};

/** Whether a polyline keeps `pad` clear of every box. */
export const pathClears = (path: readonly P[], boxes: readonly Box[], pad: number): boolean => boxes.every((r) => !pathHits(path, inflate(r, pad)));

/**
 * How much of polyline `a` runs closer than `within` to polyline `b`, in
 * length along `a`, leaving out what lies within `skip` of any point in `ends`.
 */
export const nearRun = (a: readonly P[], b: readonly P[], within: number, ends: readonly P[] = [], skip = 0): number => {
    const chunks = chunksOf(b);
    let run = 0;
    for (let i = 1; i < a.length; i++) {
        const p = a[i];
        if (ends.some((e) => Math.hypot(e.x - p.x, e.y - p.y) <= skip)) continue;
        const near = chunks.some(
            (c) => p.x >= c.x0 - within && p.x <= c.x1 + within && p.y >= c.y0 - within && p.y <= c.y1 + within && distanceToPath(p, b.slice(c.from - 1, c.to)) < within
        );
        if (near) run += Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y);
    }
    return run;
};

/** The shortest distance from `p` to segment `a`–`b`. */
const distanceToSegment = (p: P, a: P, b: P): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

export const distanceToPath = (p: P, path: readonly P[]): number => {
    if (path.length === 1) return Math.hypot(p.x - path[0].x, p.y - path[0].y);
    let best = Infinity;
    for (let i = 1; i < path.length; i++) best = Math.min(best, distanceToSegment(p, path[i - 1], path[i]));
    return best;
};

/** A polyline's segments in runs of 16, each with the box it spans: crossings compare boxes before segments. */
const CHUNK = 16;
const chunksOf = (path: readonly P[]) => {
    const out: { from: number; to: number; x0: number; x1: number; y0: number; y1: number }[] = [];
    for (let from = 1; from < path.length; from += CHUNK) {
        const to = Math.min(path.length, from + CHUNK);
        let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
        for (let i = from - 1; i < to; i++) {
            x0 = Math.min(x0, path[i].x);
            x1 = Math.max(x1, path[i].x);
            y0 = Math.min(y0, path[i].y);
            y1 = Math.max(y1, path[i].y);
        }
        out.push({ from, to, x0, x1, y0, y1 });
    }
    return out;
};

/**
 * How many times two polylines cross, leaving out crossings within `radius`
 * of any point in `near`: where strings that share an end meet, by design.
 */
export const crossings = (a: readonly P[], b: readonly P[], near: readonly P[] = [], radius = 0): number => {
    const cross = (p: P, q: P, r: P) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const [ca, cb] = [chunksOf(a), chunksOf(b)];
    let n = 0;
    for (const u of ca)
        for (const v of cb) {
            if (u.x1 < v.x0 || v.x1 < u.x0 || u.y1 < v.y0 || v.y1 < u.y0) continue;
            for (let i = u.from; i < u.to; i++) {
                const [p1, p2] = [a[i - 1], a[i]];
                for (let j = v.from; j < v.to; j++) {
                    const [q1, q2] = [b[j - 1], b[j]];
                    const d1 = cross(q1, q2, p1);
                    const d2 = cross(q1, q2, p2);
                    if (!((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))) continue;
                    const d3 = cross(p1, p2, q1);
                    const d4 = cross(p1, p2, q2);
                    if (!((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) continue;
                    const t = d1 / (d1 - d2);
                    const at = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
                    if (!near.some((e) => Math.hypot(e.x - at.x, e.y - at.y) <= radius)) n++;
                }
            }
        }
    return n;
};
