import { beforeAll, describe, expect, it } from "@jest/globals";
import { reviewElements } from "../driver/elements.ts";
import { excalidrawFixture, honoFixture, reviewOf } from "../test/fixture.ts";
import { crowded, syntheticPr, twoThreads } from "../test/synthetic.ts";
import { catmullRomSpline, distanceToPath, inflate, nearRun, pathHits } from "./curve.ts";
import { STRING_COLOURS, STRING_TEXT, planBoard, shiftPlan, stepsOf, type BoardPlan, type PlannedString, type Point, type Rect } from "./layout.ts";
import { crossingsAmong, hooks, stringCrossings, throughBends } from "./layout/bends.ts";
import { LAYOUT } from "./layout/constants.ts";
import { textRect } from "./layout/geometry.ts";
import type { Review } from "./model.ts";

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** Just under the clearance, so boxes exactly 8 apart pass. */
const NEAR = LAYOUT.clearance - 0.01;
/** How far a string across hangs at its middle: 8 % of its length, from 20 to 48. */
const sagOf = (length: number) => Math.min(48, Math.max(20, length * 0.08));

const boards = (): [string, () => Promise<Review>][] => {
    const mixed = syntheticPr("fix: a column of mixed widths", [
        {
            path: "src/mixed.ts",
            functions: [
                { name: "startJob", calls: ["shortHelper", "veryWideHelper", "middleHelper"], change: "changed" },
                { name: "shortHelper", change: "changed" },
                { name: "veryWideHelper", change: "changed", wide: 100 },
                { name: "middleHelper", change: "changed", wide: 40 },
            ],
        },
    ]);
    return [
        ["hono#5513", () => reviewOf(honoFixture())],
        ["two threads and a cycle", () => reviewOf(twoThreads())],
        ["a column of mixed widths", () => reviewOf(mixed)],
        ["a 32-card board", () => reviewOf(crowded())],
        ["excalidraw#12237", () => reviewOf(excalidrawFixture())],
    ];
};

/** Every box that must keep its distance: cards and labels. */
const boxesOf = (plan: BoardPlan) => [
    ...plan.strings.filter((s) => s.label).map((s) => ({ what: `label ${s.link}`, rect: textRect(s.label!), pin: null as string | null })),
    ...[...plan.pins].map(([id, rect]) => ({ what: `card ${id}`, rect, pin: id as string | null })),
];

describe.each(boards())("planBoard on %s", (_, make) => {
    let review: Review;
    let plan: BoardPlan;
    beforeAll(async () => {
        review = await make();
        plan = planBoard(review);
    });

    it("keeps cards and labels 8 apart", () => {
        const boxes = boxesOf(plan);
        const clashes: string[] = [];
        for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) if (overlaps(inflate(a.rect, NEAR), b.rect)) clashes.push(`${a.what} × ${b.what}`);
        expect(clashes).toEqual([]);
    });

    it("draws each string as the curve Drawdy draws, 8 clear of every card and label but its own two cards, with no hooks", () => {
        const boxes = boxesOf(plan);
        for (const s of plan.strings) {
            expect(s.path).toEqual(catmullRomSpline([s.start, ...s.bend, s.end], 20));
            const others = boxes.filter((b) => b.pin !== s.from.pin && b.pin !== s.to.pin && b.what !== `label ${s.link}`);
            expect([s.link, others.filter((b) => pathHits(s.path, inflate(b.rect, NEAR))).map((b) => b.what)]).toEqual([s.link, []]);
            expect([s.link, s.route, hooks(s.route, s.path, s.start, s.end)]).toEqual([s.link, s.route, false]);
        }
    });

    it("never runs a string along any edge of a card, closer than 24 for 120 or more, where it would read as the card's border", () => {
        for (const s of plan.strings)
            for (const [id, r] of plan.pins) {
                const [x0, y0, x1, y1] = [r.x, r.y, r.x + r.width, r.y + r.height];
                for (const [a, b] of [
                    [{ x: x0, y: y0 }, { x: x0, y: y1 }],
                    [{ x: x1, y: y0 }, { x: x1, y: y1 }],
                    [{ x: x0, y: y0 }, { x: x1, y: y0 }],
                    [{ x: x0, y: y1 }, { x: x1, y: y1 }],
                ])
                    expect([s.link, id, nearRun(s.path, [a, b], 24) < 120]).toEqual([s.link, id, true]);
            }
    });

    it("puts each label beside a bend between two other bends, the middle one of three, clear of the string, and of every other string by 8", () => {
        for (const s of plan.strings.filter((x) => x.label)) {
            const r = textRect(s.label!);
            const middle = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            const inner = s.bend.slice(1, -1);
            expect(Math.min(...inner.map((b) => Math.hypot(middle.x - b.x, middle.y - b.y)))).toBeLessThan(r.width / 2 + 40);
            expect(pathHits(s.path, r)).toBe(false);
            for (const o of plan.strings.filter((x) => x !== s)) expect([s.link, o.link, pathHits(o.path, inflate(r, NEAR))]).toEqual([s.link, o.link, false]);
        }
    });

    it("gives each band's entries the band's top, stacked 48 apart (58 on a roomier board) when there are several", () => {
        const stacks: number[] = [LAYOUT.stack, ...LAYOUT.roomier.map((r) => r.stack)];
        for (const [b, band] of review.bands.entries()) {
            const flow = review.pins.filter((p) => p.band === b && p.lane === "flow" && p.kind !== "context").map((p) => plan.pins.get(p.id)!);
            const top = Math.min(...flow.map((r) => r.y));
            expect(plan.pins.get(band.entries[0])!.y).toBe(top);
            for (const entry of band.entries) {
                const r = plan.pins.get(entry)!;
                const above = flow.filter((o) => o.x === r.x && o.y < r.y);
                expect([entry, r.y === top || above.some((o) => stacks.includes(r.y - (o.y + o.height)))]).toEqual([entry, true]);
            }
        }
    });

    it("moves right, or down a column, within a band; left only at a line break", () => {
        const flow = stepsOf(review).map((id) => review.pins.find((p) => p.id === id)!).filter((p) => p.lane === "flow");
        for (const [i, pin] of flow.entries()) {
            if (i === 0 || flow[i - 1].band !== pin.band) continue;
            const a = plan.pins.get(flow[i - 1].id)!;
            const b = plan.pins.get(pin.id)!;
            const rightOf = b.x >= a.x + a.width;
            const belowInColumn = b.x === a.x && b.y > a.y;
            expect([flow[i - 1].name, pin.name, rightOf || belowInColumn]).toEqual([flow[i - 1].name, pin.name, true]);
        }
    });

    it("draws a string from the row under only to a card above its own card, overlapping it in x", () => {
        const pinRect = (id: string) => plan.pins.get(id)!;
        for (const s of plan.strings.filter((x) => review.pins.find((p) => p.id === x.from.pin)!.lane === "under")) {
            const [a, b] = [pinRect(s.from.pin), pinRect(s.to.pin)];
            expect([s.link, a.x < b.x + b.width && b.x < a.x + a.width]).toEqual([s.link, true]);
        }
    });

    it("ties every card in the row under a band to the board with at least one string", () => {
        for (const p of review.pins.filter((x) => x.lane === "under")) expect([p.name, plan.strings.some((s) => s.from.pin === p.id)]).toEqual([p.name, true]);
    });

    it("binds every string to both cards with three bends (R1' through columns: one every 64 or so), no elbows and no roughness, after both cards in one call", () => {
        let n = 0;
        const { elements, pinIds, linkIds } = reviewElements(review, plan, () => `e${n++}`);
        const added = new Set<string>();
        for (const e of elements) {
            if (e.type === "component") added.add(e.drawdyElementId);
            if (e.type !== "arrow") continue;
            const planned = plan.strings.find((x) => x.link === [...linkIds].find(([, id]) => id === e.drawdyElementId)![0])!;
            if (planned.route === "R1'") expect(e.bend!.length).toBeGreaterThanOrEqual(3);
            else expect(e.bend).toHaveLength(3);
            expect(e.elbowRouting).toBeUndefined();
            expect("roughness" in e).toBe(false);
            expect("from" in e && e.from).toBeFalsy();
            expect(added.has(e.startBinding!.drawdyElementId) && added.has(e.endBinding!.drawdyElementId)).toBe(true);
        }
        expect([...pinIds.values()].every((id) => added.has(id))).toBe(true);
        expect(elements.every((e) => e.type === "component" || e.type === "arrow" || e.type === "text")).toBe(true);
        // Nothing is grouped: a click on a card selects that card alone.
        expect(elements.every((e) => !("groupId" in e))).toBe(true);
    });

    it("colours strings from one card alike, and strings from two cards apart where they cross, meet or run close, while the palette lasts", () => {
        const byCard = new Map<string, Set<string>>();
        for (const s of plan.strings) byCard.set(s.from.pin, new Set([...(byCard.get(s.from.pin) ?? []), s.style.color]));
        expect([...byCard.values()].every((c) => c.size === 1)).toBe(true);
        if (byCard.size <= STRING_COLOURS.length) {
            const clash = plan.strings.flatMap((a, i) => plan.strings.slice(i + 1).filter((b) => a.from.pin !== b.from.pin && a.style.color === b.style.color && stringCrossings(a, b) > 0));
            expect(clash).toEqual([]);
        }
    });

    it("joins strings only at a shared end: into one edge of a card at one point, out of one row at one point", () => {
        const key = (p: Point) => `${Math.round(p.x)},${Math.round(p.y)}`;
        const edge = (s: (typeof plan.strings)[number]) => `${s.to.pin}:${s.to.anchorX === 0 ? "left" : s.to.anchorX === 1 ? "right" : s.to.anchorY === 0 ? "top" : "bottom"}`;
        const ends = new Map<string, Set<string>>();
        for (const s of plan.strings) ends.set(edge(s), new Set([...(ends.get(edge(s)) ?? []), key(s.end)]));
        expect([...ends].filter(([, points]) => points.size > 1)).toEqual([]);
    });
});

describe("planBoard on hono#5513", () => {
    let review: Review;
    let plan: BoardPlan;
    beforeAll(async () => {
        review = await reviewOf(honoFixture());
        plan = planBoard(review);
    });
    const at = (name: string) => plan.pins.get(review.pins.find((p) => p.name === name)!.id)!;
    const stringOf = (kind: string) => plan.strings.filter((s) => s.kind === kind);

    it("draws nine of its ten links, four calls, the unchanged caller, three tests and one imports, each labelled with one word where it clears", () => {
        expect(plan.strings.map((s) => `${s.kind}:${s.label?.text}`).sort()).toEqual(
            ["calls:calls", "calls:calls", "calls:calls", "calls:calls", "context:calls", "tests:tests", "tests:tests", "tests:undefined", "imports:imports"].sort()
        );
        // hono.test.ts's dashed string climbs to fetch() at the band's top, past the band's strings, where its word clears nowhere.
        expect(plan.strings.find((s) => !s.label)!.link).toBe("tests:test:src/hono.test.ts>ctx:src/hono-base.ts:484");
        // The imports card's second link, up to compose(), finds no route clear of compose.test.ts: the panel lists it.
        expect(plan.undrawn).toEqual(["imports:file:src/hono-base.ts>src/compose.ts:18"]);
        expect(plan.strings.map((s) => s.route).sort()).toEqual(["R1", "R1", "R1", "R1", "R1", "R2", "R2", "R2", "R3"]);
    });

    it("hangs the imports card in the row under, as near the mean of compose() and toError(), which line 7 imports, as compose.test.ts leaves room, with a string up to the middle of toError()'s bottom", () => {
        const imports = at("hono-base.ts imports");
        const toError = at("toError()");
        const test = at("compose.test.ts");
        expect(imports.x).toBe(test.x + test.width + LAYOUT.stack);
        expect(imports.x).toBeLessThan(toError.x + toError.width / 2);
        expect(imports.y).toBe(test.y);
        const up = stringOf("imports")[0];
        expect([up.start.y, up.end.y, up.to.anchorX, up.to.anchorY]).toEqual([imports.y, toError.y + toError.height, 0.5, 1]);
    });

    it("places every card where the spec says, within 8", () => {
        const rects = Object.fromEntries([...plan.pins].map(([id, r]) => [review.pins.find((p) => p.id === id)!.name, [r.x, r.y, r.width]]));
        const spec: Record<string, number[]> = {
            "The PR": [0, 0, 640],
            "fetch()": [800, 0, 673],
            "#dispatch()": [1633, 0, 810],
            "#handleError()": [2603, 218, 726],
            "compose()": [2603, 534, 726],
            "toError()": [3489, 356, 880],
            "compose.test.ts": [2622, 1014, 688],
            "hono-base.ts imports": [3358, 1014, 574],
            "onError()": [800, 1358, 880],
            "hono.test.ts": [1840, 1358, 863],
        };
        for (const [name, want] of Object.entries(spec)) expect([name, rects[name]]).toEqual([name, rects[name].every((v, i) => Math.abs(v - want[i]) <= 8) ? rects[name] : want]);
        expect(at("The PR").height).toBe(779);
        expect([plan.bounds.width, plan.bounds.height]).toEqual([4369, 1606]);
    });

    it("stands the PR card alone in the first column, the code 160 right of it, the unchanged caller at the band's top, stacks cards 48 apart and columns 160 apart", () => {
        expect([at("The PR").x, at("The PR").y]).toEqual([0, 0]);
        expect(at("fetch()").x).toBe(at("The PR").x + at("The PR").width + LAYOUT.columnGap);
        expect([at("fetch()").y, at("#dispatch()").y]).toEqual([0, 0]);
        expect(at("compose()").y - (at("#handleError()").y + at("#handleError()").height)).toBe(LAYOUT.stack);
        expect(at("#dispatch()").x - (at("fetch()").x + at("fetch()").width)).toBe(LAYOUT.columnGap);
        expect(at("#handleError()").x - (at("#dispatch()").x + at("#dispatch()").width)).toBe(LAYOUT.columnGap);
        expect(at("compose()").width).toBe(at("#handleError()").width);
    });

    it("puts hono.test.ts right after onError() in the bottom row, a flat string between them, sagging like string", () => {
        const flat = stringOf("tests").find((s) => s.route === "R3")!;
        expect([flat.start.x, flat.start.y]).toEqual([at("hono.test.ts").x, at("hono.test.ts").y + 28]);
        expect([flat.end.x, flat.end.y]).toEqual([at("onError()").x + at("onError()").width, at("onError()").y + 28]);
        expect(flat.bend[1].y - flat.start.y).toBeCloseTo(sagOf(at("hono.test.ts").x - (at("onError()").x + at("onError()").width)), 5);
    });

    it("leaves each call string from the row that makes the call, and ends it at the target's header, sagging like string", () => {
        const dispatch = at("#dispatch()");
        const compose = at("compose()");
        const s = plan.strings.find((x) => x.link === "calls:src/hono-base.ts:411>src/compose.ts:18")!;
        expect(s.start.x).toBe(dispatch.x + dispatch.width);
        expect([s.end.x, s.end.y]).toEqual([compose.x, compose.y + 28]);
        const d = { x: s.end.x - s.start.x, y: s.end.y - s.start.y };
        const sag = sagOf(Math.hypot(d.x, d.y));
        // Straight from end to end, hanging 3/4 of the sag at the outer bends and all of it in the middle.
        expect(s.bend.map((b) => b.x)).toEqual([0.25, 0.5, 0.75].map((t) => s.start.x + d.x * t));
        [0.75, 1, 0.75].forEach((hang, i) => expect(s.bend[i].y - (s.start.y + d.y * [0.25, 0.5, 0.75][i])).toBeCloseTo(sag * hang));
    });

    it("lines the code's column 0 up 160 right of the PR card, #handleError() above compose() by call row, and toError() with #handleError()", () => {
        expect([at("fetch()").x, at("onError()").x]).toEqual([800, 800]);
        expect(at("#handleError()").y).toBeLessThan(at("compose()").y);
        expect(at("toError()").y).toBe(at("#handleError()").y + 56 + 5 * 20 + 10 - 28);
        expect(at("compose.test.ts").y).toBeGreaterThan(at("compose()").y + at("compose()").height);
        expect(plan.order).toEqual(["pr", "ctx:src/hono-base.ts:484", ...stepsOf(review)]);
    });

    it("dashes the strings into and out of the unchanged caller, and colours strings apart, not by kind", () => {
        expect(plan.strings.filter((s) => s.style.dash === "dashed").map((s) => s.link)).toEqual([
            "context:ctx:src/hono-base.ts:484>src/hono-base.ts:411",
            "tests:test:src/hono.test.ts>ctx:src/hono-base.ts:484",
        ]);
        expect(plan.strings.every((s) => STRING_COLOURS.includes(s.style.color as (typeof STRING_COLOURS)[number]))).toBe(true);
    });

    it("keeps each label beside its string after compose() moves by 200: a drag moves only the ends, and the curve keeps its middle bend", () => {
        for (const s of plan.strings.filter((x) => x.label && (x.from.pin === "src/compose.ts:18" || x.to.pin === "src/compose.ts:18"))) {
            const moved = (p: Point, on: boolean) => (on ? { x: p.x + 200, y: p.y } : p);
            const start = moved(s.start, s.from.pin === "src/compose.ts:18");
            const end = moved(s.end, s.to.pin === "src/compose.ts:18");
            // As Drawdy keeps them: [start, end, ...bend], drawn through [start, ...bend, end].
            const points = [start, end, ...s.bend];
            const path = catmullRomSpline([points[0], ...points.slice(2), points[1]], 20);
            expect(distanceToPath(s.bend[1], path)).toBeLessThan(0.001);
            const r = textRect(s.label!);
            expect(pathHits(path, r)).toBe(false);
            expect(distanceToPath({ x: r.x + r.width / 2, y: r.y + r.height / 2 }, path)).toBeLessThan(r.width / 2 + 30);
        }
    });

    it("moves as one block", () => {
        const moved = shiftPlan(plan, { x: 5000, y: -200 });
        expect(moved.bounds).toMatchObject({ x: 5000, y: -200, width: plan.bounds.width });
        expect(moved.pins.get("pr")!.x - moved.bounds.x).toBe(plan.pins.get("pr")!.x - plan.bounds.x);
        expect(moved.strings[0].bend[1].x - moved.bounds.x).toBe(plan.strings[0].bend[1].x - plan.bounds.x);
        expect(moved.strings[0].path[7].y - moved.bounds.y).toBeCloseTo(plan.strings[0].path[7].y - plan.bounds.y);
    });
});

describe("planBoard around a tall PR card", () => {
    it("moves no code card for a long description: the PR card grows down its own column", async () => {
        const review = await reviewOf(honoFixture());
        const body = Array.from({ length: 5 }, (_, i) => `## Part ${i + 1}\n\n${review.pr.body}`).join("\n\n");
        const tall = planBoard({ ...review, pr: { ...review.pr, body } });
        const plan = planBoard(review);
        expect(tall.pins.get("pr")!.height).toBeGreaterThan(3000);
        const code = (p: BoardPlan) => [...p.pins].filter(([id]) => id !== "pr");
        expect(code(tall)).toEqual(code(plan));
        expect(tall.strings.map((s) => s.path)).toEqual(plan.strings.map((s) => s.path));
    });
});

describe("planBoard from the row under, a card with no other string", () => {
    it("keeps the card's shortest sideways link that routes, so a card with links never stands alone", async () => {
        const review = await reviewOf(
            syntheticPr("feat: a chain tested twice", [
                {
                    path: "src/chain.ts",
                    functions: [
                        { name: "first", calls: ["second"], change: "changed" },
                        { name: "second", calls: ["third"], change: "changed" },
                        { name: "third", change: "changed" },
                    ],
                },
                { path: "test/a.test.ts", tests: ["first"] },
                { path: "test/b.test.ts", tests: ["first"] },
            ])
        );
        const plan = planBoard(review);
        const rect = (name: string) => plan.pins.get(review.pins.find((p) => p.name === name)!.id)!;
        // b.test.ts stands right of a.test.ts, clear of first() in x: its one link runs sideways, and still gets its string.
        expect(rect("b.test.ts").x).toBeGreaterThan(rect("first()").x + rect("first()").width);
        const name = (id: string) => review.pins.find((p) => p.id === id)!.name;
        expect(plan.strings.filter((s) => s.kind === "tests").map((s) => `${name(s.from.pin)} → ${name(s.to.pin)}`).sort()).toEqual(["a.test.ts → first()", "b.test.ts → first()"]);
        expect(plan.undrawn).toEqual([]);
    });
});

describe("planBoard on two threads and a cycle", () => {
    it("draws the padCells() → formatRows() cycle back over both cards", async () => {
        const review = await reviewOf(twoThreads());
        const plan = planBoard(review);
        const back = plan.strings.find((s) => s.link.includes("render.ts") && s.route === "R4")!;
        const from = plan.pins.get(back.from.pin)!;
        const to = plan.pins.get(back.to.pin)!;
        expect([back.from.anchorY, back.to.anchorY]).toEqual([0, 0]);
        expect(Math.max(...back.bend.map((p) => p.y))).toBeLessThan(Math.min(from.y, to.y));
    });
});

describe("planBoard on excalidraw#12237", () => {
    let review: Review;
    let plan: BoardPlan;
    beforeAll(async () => {
        review = await reviewOf(excalidrawFixture());
        plan = planBoard(review);
    });
    const count = (paths: Pick<PlannedString, "start" | "end" | "path">[]) => crossingsAmong(paths, stringCrossings);

    it("crosses its strings no more often than straight lines between the same ends would", () => {
        const straight = plan.strings.map((s) => ({ start: s.start, end: s.end, path: [s.start, s.end] }));
        expect(count(plan.strings)).toBeLessThanOrEqual(count(straight));
    });

    it("draws at most the nearest three strings of a kind into one card, lists every link it leaves off, and leaves at most 1 in 8 to the panel", () => {
        expect(plan.strings.length + plan.undrawn.length).toBe(review.links.length);
        const into = new Map<string, number>();
        for (const s of plan.strings) into.set(`${s.to.pin} ${s.kind}`, (into.get(`${s.to.pin} ${s.kind}`) ?? 0) + 1);
        expect(Math.max(...into.values())).toBeLessThanOrEqual(LAYOUT.fanIn);
        expect(plan.undrawn.length * 8).toBeLessThanOrEqual(review.links.length);
    });

    it("keeps its column gaps at 240 at most, and labels at least 3 strings in 4", () => {
        const xs = [...new Set(review.pins.filter((p) => p.lane === "flow").map((p) => plan.pins.get(p.id)!.x))].sort((a, b) => a - b);
        const gaps = xs.slice(1).map((x, i) => x - Math.max(...[...plan.pins.values()].filter((r) => r.x === xs[i]).map((r) => r.x + r.width)));
        expect(Math.max(...gaps)).toBeLessThanOrEqual(240);
        expect(plan.strings.filter((s) => s.label).length * 4).toBeGreaterThanOrEqual(plan.strings.length * 3);
    });

    it("runs a string through a column flat along a gap between two cards", () => {
        const through = plan.strings.filter((s) => s.route === "R1'");
        expect(through.length).toBeGreaterThan(0);
        for (const s of through) {
            const steps = s.bend.slice(1).map((b, i) => Math.hypot(b.x - s.bend[i].x, b.y - s.bend[i].y));
            expect(Math.max(...steps) / Math.min(...steps)).toBeLessThan(1.6);
        }
    });
});

describe("string colours as panel text", () => {
    /** WCAG 2's contrast ratio of two `#rrggbb` colours. */
    const contrast = (a: string, b: string) => {
        const luminance = (hex: string) => {
            const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
            return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
        };
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    };

    it("read 4.6:1 or more on the panel in its theme, one for each string colour, in its order", () => {
        const panel = { light: "#ffffff", dark: "#27272a" } as const;
        for (const theme of ["light", "dark"] as const) {
            expect(STRING_TEXT[theme]).toHaveLength(STRING_COLOURS.length);
            for (const colour of STRING_TEXT[theme]) expect([theme, colour, contrast(colour, panel[theme]) >= 4.6]).toEqual([theme, colour, true]);
        }
        // Where the board's colour reads already, the panel uses it as drawn.
        expect(STRING_TEXT.dark[4]).toBe(STRING_COLOURS[4].toLowerCase());
        expect(STRING_TEXT.dark[5]).toBe(STRING_COLOURS[5]);
    });
});

describe("throughBends", () => {
    it("runs level along each column's lane and eases between, with bends evenly spaced", () => {
        const bends = throughBends({ x: 0, y: 0 }, { x: 2000, y: 300 }, [{ lo: 400, hi: 1200, y: 500 }]);
        const inLane = bends.filter((b) => b.x >= 400 && b.x <= 1200);
        expect(inLane.length).toBeGreaterThan(5);
        expect(inLane.every((b) => Math.abs(b.y - 500) < 0.001)).toBe(true);
        const path = catmullRomSpline([{ x: 0, y: 0 }, ...bends, { x: 2000, y: 300 }], 20);
        expect(path.filter((p) => p.x >= 400 && p.x <= 1200).every((p) => Math.abs(p.y - 500) < 4)).toBe(true);
    });
});

describe("planBoard from the row under", () => {
    it("leaves a test's string to a card not above it to the panel: it would cross the board sideways", async () => {
        const chain = syntheticPr("feat: a chain and its tests", [
            {
                path: "src/chain.ts",
                functions: [
                    { name: "first", calls: ["second"], change: "changed" },
                    { name: "second", calls: ["third"], change: "changed" },
                    { name: "third", calls: ["fourth"], change: "changed" },
                    { name: "fourth", change: "changed" },
                ],
            },
            { path: "test/chain.test.ts", tests: ["first", "fourth"] },
            { path: "test/second.test.ts", tests: ["second"] },
        ]);
        const review = await reviewOf(chain);
        const plan = planBoard(review);
        const name = (id: string) => review.pins.find((p) => p.id === id)!.name;
        const said = (ids: readonly string[]) => ids.map((id) => review.links.find((l) => l.id === id)!).map((l) => `${l.kind} ${name(l.from)} → ${name(l.to)}`);
        expect(review.pins.filter((p) => p.lane === "under").map((p) => p.name)).toEqual(["chain.test.ts", "second.test.ts"]);
        expect(said(plan.strings.map((s) => s.link)).sort()).toEqual(["calls first() → second()", "calls second() → third()", "calls third() → fourth()", "tests chain.test.ts → fourth()", "tests second.test.ts → second()"]);
        expect(said(plan.undrawn)).toEqual(["tests chain.test.ts → first()"]);
    });
});

describe("planBoard on a long chain of calls", () => {
    it("starts a card at its band's top rather than hang it more than maxDrop below, so the band doesn't become a staircase", async () => {
        const chain = syntheticPr("feat: a chain", [
            { path: "src/chain.ts", functions: Array.from({ length: 7 }, (_, i) => ({ name: `link${i}`, body: 30, calls: i < 6 ? [`link${i + 1}`] : [], change: "changed" as const })) },
        ]);
        const review = await reviewOf(chain);
        const plan = planBoard(review);
        const tops = review.pins.filter((p) => p.kind === "change").map((p) => plan.pins.get(p.id)!.y);
        expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(LAYOUT.maxDrop);
        expect(tops.filter((y) => y === Math.min(...tops)).length).toBeGreaterThan(1);
        expect(plan.undrawn).toEqual([]);
    });
});

describe("planBoard without functions", () => {
    it("draws a files-mode board's strings, and a docs-only board as the PR card beside one row", async () => {
        const files = syntheticPr("chore: docs", [
            { path: "README.md", text: ["One."] },
            { path: "docs/guide.md", text: ["Two."] },
        ]);
        const docs = await reviewOf(files);
        const plan = planBoard(docs);
        expect(docs.mode).toBe("files");
        const pr = plan.pins.get("pr")!;
        const row = [...plan.pins].filter(([id]) => id !== "pr").map(([, r]) => r);
        expect(row.every((r) => r.y === pr.y && r.x >= pr.x + pr.width + LAYOUT.columnGap)).toBe(true);
        const linked = await reviewOf({
            pr: { ...files.pr, changedFiles: 2 },
            files: [
                { path: "src/app.js", status: "modified", additions: 1, deletions: 0, patch: '@@ -1,1 +1,2 @@\n import { size } from "./size.js"\n+console.log(size)' },
                { path: "src/size.js", status: "modified", additions: 1, deletions: 1, patch: "@@ -1,1 +1,1 @@\n-export const size = 1\n+export const size = 2" },
            ],
            raw: new Map([
                ["src/app.js", 'import { size } from "./size.js"\nconsole.log(size)'],
                ["src/size.js", "export const size = 2"],
            ]),
        });
        const strings = planBoard(linked).strings;
        expect([linked.mode, strings.map((s) => s.kind), strings.every((s) => s.style.color === STRING_COLOURS[0])]).toEqual(["files", ["uses"], true]);
    });
});
