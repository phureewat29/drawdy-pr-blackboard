/**
 * The links between a board's cards: each resolved reference goes from the
 * innermost card holding it to the card standing for what it names: that
 * declaration's own card, a card it is nested in when it has none, its
 * `alt`'s card (a constructor's class), or the file card showing a file's
 * changed lines. Two declaration cards that nest make no link.
 */

import { addedLines, allLines } from "../diff.ts";
import { groupBy, minBy } from "../fp.ts";
import type { Ref, Unit } from "../langs/pack.ts";
import type { Link, LinkKind, Pin } from "../model.ts";
import type { Flat } from "../syntax.ts";
import type { BoardContext } from "./cards.ts";

/** A stretch of a file a card shows. */
type Region = { pin: Pin; path: string; start: number; end: number };

const lineStart = (t: Flat, line: number) => (line > t.lineStarts.length ? t.text.length : t.lineStarts[Math.max(0, line - 1)]);
const lineEnd = (t: Flat, line: number) => (line < t.lineStarts.length ? t.lineStarts[line] : t.text.length);

/**
 * What each card shows, and which card stands for each changed unit: a
 * declaration card its unit and the changed units nested in it without a
 * card of their own; a whole file card the file and its changed units left;
 * a file card about some changes, their lines; a test card its file.
 */
const regionsOf = (pins: readonly Pin[], { facts, units }: BoardContext) => {
    const regions = new Map<Pin, Region[]>();
    const represented = new Map<string, string>();
    const pinIds = new Set(pins.map((p) => p.id));
    const changedUnits = groupBy([...units.values()], (u) => u.path);
    const unitOfPin = new Map<Pin, Unit>();
    for (const p of pins) {
        const u = units.get(p.id) ?? (p.kind === "context" && p.path ? facts.get(p.path)?.units.find((u) => `ctx:${u.id}` === p.id) : undefined);
        if (!p.path || !u) continue;
        unitOfPin.set(p, u);
        regions.set(p, [{ pin: p, path: p.path, start: u.start, end: u.end }]);
        represented.set(u.id, p.id);
        for (const x of changedUnits[u.path] ?? []) if (x !== u && u.start <= x.start && x.end <= u.end && !pinIds.has(x.id)) represented.set(x.id, p.id);
    }
    for (const p of pins) {
        const t = p.path && (p.kind === "file" || p.kind === "test") ? facts.get(p.path)?.flat : undefined;
        if (!t || !p.path) continue;
        if (p.kind === "file" && p.ranges) {
            regions.set(
                p,
                p.ranges.map((r) => ({ pin: p, path: p.path!, start: lineStart(t, r.from), end: lineEnd(t, r.to) }))
            );
            continue;
        }
        regions.set(p, [{ pin: p, path: p.path, start: 0, end: t.text.length }]);
        if (p.kind === "file") for (const x of changedUnits[p.path] ?? []) if (!represented.has(x.id)) represented.set(x.id, p.id);
    }
    return { regions, represented, unitOfPin };
};

/** Where a string starts: the first changed call row, else the first call row, else the first changed row, else the first. */
const startRow = (calls: readonly number[], rows: readonly number[], changed: ReadonlySet<number>): number | undefined =>
    calls.find((n) => changed.has(n)) ?? calls[0] ?? rows.find((n) => changed.has(n)) ?? rows[0];

export const linksOf = (pins: readonly Pin[], ctx: BoardContext): Link[] => {
    const { regions, represented, unitOfPin } = regionsOf(pins, ctx);
    const regionsIn = groupBy([...regions.values()].flat(), (r) => r.path);
    /** The card of the innermost region holding an offset. */
    const pinAt = (path: string, offset: number): Pin | undefined =>
        minBy(
            (regionsIn[path] ?? []).filter((r) => offset >= r.start && offset < r.end),
            (r) => r.end - r.start
        )?.pin;
    /** Whether every region of b lies in one of a's. */
    const holds = (a: Pin, b: Pin) => {
        const ra = regions.get(a) ?? [];
        const rb = regions.get(b) ?? [];
        return rb.length > 0 && rb.every((y) => ra.some((x) => x.path === y.path && x.start <= y.start && y.end <= x.end));
    };
    const isDecl = (p: Pin) => (p.kind === "change" || p.kind === "context") && unitOfPin.has(p);
    const pinById = new Map(pins.map((p) => [p.id, p]));

    // The references each pair of cards shares, from → to, each reference once.
    const pairs = new Map<string, { from: Pin; to: Pin; refs: Set<Ref> }>();
    for (const r of ctx.refs) {
        const from = pinAt(r.path, r.start);
        if (!from) continue;
        for (const u of r.units) {
            const to = pinById.get(represented.get(u.id) ?? (r.alt ? represented.get(r.alt.id) : undefined) ?? "");
            if (!to || to === from) continue;
            if (isDecl(from) && isDecl(to) && (holds(from, to) || holds(to, from))) continue;
            const key = `${from.id}>${to.id}`;
            const pair = pairs.get(key) ?? { from, to, refs: new Set<Ref>() };
            pair.refs.add(r);
            pairs.set(key, pair);
        }
    }

    const fileByPath = new Map(ctx.files.map((f) => [f.path, f]));
    const addedIn = new Map<string, Set<number>>();
    /** The head lines a file adds, read once per file a string starts in. */
    const changedIn = (path = ""): Set<number> => {
        let lines = addedIn.get(path);
        if (!lines) addedIn.set(path, (lines = addedLines(allLines(fileByPath.get(path)?.hunks ?? []))));
        return lines;
    };
    return [...pairs.values()].map(({ from, to, refs }) => {
        const rs = [...refs];
        const calls = [...new Set(rs.filter((r) => r.ref === "call").map((r) => r.line))].sort((a, b) => a - b);
        const all = [...new Set(rs.map((r) => r.line))].sort((a, b) => a - b);
        const kind: LinkKind = from.kind === "test" ? "tests" : from.kind === "context" ? "context" : calls.length > 0 ? "calls" : rs.some((r) => r.ref !== "import" && r.ref !== "export") ? "uses" : "imports";
        // How a context link reads: `calls` when one of its references is a call.
        const reads = kind === "context" ? (calls.length > 0 ? "calls" : "uses") : undefined;
        const at = startRow(calls, all, changedIn(from.path));
        return {
            id: `${kind}:${from.id}>${to.id}`,
            from: from.id,
            to: to.id,
            kind,
            ...(reads ? { reads } : {}),
            ...(at !== undefined ? { at } : {}),
            // Its calls for `calls` (and a context link that calls), else every reference.
            rows: kind === "calls" || reads === "calls" ? calls : all,
        };
    });
};
