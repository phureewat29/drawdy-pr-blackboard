/**
 * Renders the investigation board to HTML and screenshots it with headless
 * Chrome, so the design can be reviewed without a live Drawdy board.
 *
 * Everything comes from the real pipeline: `buildReview`, `planBoard` and
 * the element schemas `reviewElements` sends to Drawdy. Cards are their own
 * srcDoc HTML in iframes. Strings are drawn exactly as Drawdy draws them:
 * its Catmull-Rom spline through `[start, ...bend, end]`, the arrowhead
 * along the last segment, no roughness; a handwriting face stands in for
 * Drawdy's on the labels. Close-ups show the board at reading zoom through
 * the step camera, with Read all on the board where it opens, and the panel
 * in its strip. For each board it prints the links drawn and not, and how
 * often strings cross, against straight strings between the same ends; for
 * each PR card it prints the description's height as Chrome lays it out
 * beside `markdownHeight`'s estimate.
 *
 * Usage: node scripts/preview-board.ts [out-dir] [saved-pr.json ...]. Each
 * saved pull request (the fixtures' shape, by absolute path) adds its
 * overview and PR card.
 */

import type { DomElementSchema, DrawdyElementSchema, ModuleStyling } from "@drawdy/driver-protocol";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { firstLineOf, fullFileOf, nameRect, prCard, readAllOf } from "../src/lib/card.ts";
import { STRING_COLOURS, planBoard, stepsOf, union, type BoardPlan, type PlannedString, type Point, type Rect } from "../src/lib/layout.ts";
import { crossingsAmong, stringCrossings, stringPath } from "../src/lib/layout/bends.ts";
import { MARKDOWN_CSS, lexMarkdown, markdownHtml, segments } from "../src/lib/markdown.ts";
import type { Review } from "../src/lib/model.ts";
import { VIEW, overviewBounds, overviewCamera, readAllCamera, readAllRect, stepCamera, usable, type Camera, type Screen } from "../src/lib/view.ts";
import { themeCss } from "../src/driver/channel.ts";
import { reviewElements } from "../src/driver/elements.ts";
import { popoverSchema } from "../src/driver/read-all.ts";
import { currentCardOf } from "../src/driver/panel-view.ts";
import { SAID, warningsOf } from "../src/driver/warnings.ts";
import { webviewHtml } from "../src/driver/webview-html.ts";
import { projectColour } from "../src/shared/suggestions.ts";
import type { PanelView } from "../src/shared/protocol.ts";
import { excalidrawFixture, honoFixture, reviewOf, savedPr } from "../src/test/fixture.ts";
import { crowded, twoThreads } from "../src/test/synthetic.ts";

const OUT = resolve(process.argv[2] ?? join(import.meta.dirname, "..", "dist", "preview"));
const SAVED = process.argv.slice(3).map((path) => resolve(path));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(OUT, { recursive: true });

type Theme = "light" | "dark";
const BOARD = { light: { bg: "#f4f4f5", grid: "#e4e4e7" }, dark: { bg: "#18181b", grid: "#222226" } };
/** ModuleStyling as Drawdy computes it from drawdy.io's deployed tokens: the panel's background is `--surface-elevated`. */
const STYLING: Record<Theme, ModuleStyling> = {
    dark: { theme: "dark", background: "#27272a", foreground: "#fffffff2", surface: "#1f1f23", surface2: "#1f1f23", mutedForeground: "#ffffffb3", primary: "#c5f601", primaryForeground: "#090909", accent: "#e1ff6d", accentForeground: "#090909", border: "#ffffff14", input: "#ffffff1f", ring: "#c5f601", destructive: "#fb3748", success: "#53c683", warning: "#eab308", radiusSm: "4px", radiusMd: "6px", radiusLg: "8px" },
    light: { theme: "light", background: "#fff", foreground: "#000000f2", surface: "#fff", surface2: "#fafafa", mutedForeground: "#000000b3", primary: "#c5f601", primaryForeground: "#090909", accent: "#7fae00", accentForeground: "#090909", border: "#0000001a", input: "#00000029", ring: "#b3e000", destructive: "#fb3748", success: "#53c683", warning: "#eab308", radiusSm: "4px", radiusMd: "6px", radiusLg: "8px" },
};
const HAND = `'Chalkboard SE', 'Bradley Hand', 'Comic Sans MS', cursive`;

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `raw`: the PR's files at its head commit, which a card's `View full file` reads. */
type Built = { review: Review; plan: BoardPlan; elements: DrawdyElementSchema[]; rects: Map<string, Rect>; raw: ReadonlyMap<string, string> };
/** A board pinned in each theme: cards take the theme Drawdy shows when they are pinned. */
type Boards = Record<Theme, Built>;

const build = (review: Review, theme: Theme, raw: ReadonlyMap<string, string>): Built => {
    const plan = planBoard(review);
    let n = 0;
    const { elements } = reviewElements(review, plan, () => `el${n++}`, theme);
    const rects = new Map<string, Rect>();
    for (const e of elements) if ("x" in e && "width" in e && e.width !== undefined) rects.set(e.drawdyElementId, { x: e.x, y: e.y, width: e.width, height: e.height ?? 0 });
    return { review, plan, elements, rects, raw };
};

const boardsOf = (review: Review, raw: ReadonlyMap<string, string> = new Map()): Boards => ({ light: build(review, "light", raw), dark: build(review, "dark", raw) });

const anchorOf = (rects: Map<string, Rect>, b: { drawdyElementId: string; anchorX: number; anchorY: number }): Point => {
    const r = rects.get(b.drawdyElementId)!;
    return { x: r.x + r.width * b.anchorX, y: r.y + r.height * b.anchorY };
};

/** The board's elements in canvas units: strings in SVG, labels as boxes, cards above them all. */
const worldHtml = (built: Built, theme: Theme) => {
    const { elements, rects } = built;
    const svg: string[] = [];
    const boxes: string[] = [];
    const cards: string[] = [];
    elements.forEach((e) => {
        if (e.type === "arrow") {
            // As Drawdy draws it: the spline through [start, ...bend, end], the head along its last segment.
            const a = anchorOf(rects, e.startBinding!);
            const b = anchorOf(rects, e.endBinding!);
            const path = stringPath(a, (e.bend ?? []).map(([x, y]) => ({ x, y })), b);
            const color = e.color;
            const dash = e.strokeDash === "dashed" ? `stroke-dasharray="10 7"` : "";
            const last = path[path.length - 2];
            const angle = Math.atan2(b.y - last.y, b.x - last.x);
            const head = (side: number) => `${b.x - 14 * Math.cos(angle + side * 0.45)},${b.y - 14 * Math.sin(angle + side * 0.45)}`;
            svg.push(`<path d="M${path.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L")}" fill="none" stroke="${color}" stroke-width="${e.strokeWidth ?? 2}" stroke-linejoin="round" ${dash}/>`);
            svg.push(`<path d="M${head(1)} L${b.x},${b.y} L${head(-1)}" fill="none" stroke="${color}" stroke-width="${e.strokeWidth ?? 2}" stroke-linejoin="round"/>`);
        } else if (e.type === "text") {
            boxes.push(`<div style="position:absolute;left:${e.x}px;top:${e.y}px;white-space:nowrap;color:${e.color};font:${e.fontSize}px/1.25 ${HAND}">${esc(e.text)}</div>`);
        } else if (e.type === "component") {
            const box = e.schema.type === "box" ? e.schema : null;
            const frame = box?.styles?.borderWidth?.[0] ? "border:1px solid rgba(127,127,127,.35);" : "";
            const iframe = box?.children?.[0];
            const html = iframe && iframe.type === "iframe" && "srcDoc" in iframe.child ? iframe.child.srcDoc : "";
            cards.push(
                `<div style="position:absolute;left:${e.x}px;top:${e.y}px;width:${e.width}px;height:${e.height}px;border-radius:12px;overflow:hidden;box-sizing:border-box;${frame}"><iframe srcdoc="${attr(html)}" style="width:100%;height:100%;border:0;display:block;color-scheme:${theme}"></iframe></div>`
            );
        }
    });
    return `<svg style="position:absolute;left:0;top:0;overflow:visible" width="1" height="1">${svg.join("")}</svg>${boxes.join("")}${cards.join("")}`;
};

/**
 * A page showing the board through a camera, with screen-space layers on
 * top. `clipped` is drawn on the board, as Read all is, but clipped to the
 * usable view, where it slides under Drawdy's toolbar and the panel.
 */
const page = (built: Built, screen: Screen, camera: Camera, theme: Theme, layers: { overlay?: string; chrome?: boolean; clipped?: string } = {}) => {
    const zoom = camera.zoom;
    const grid = 40 * zoom;
    const view = usable(screen);
    const clipped = layers.clipped
        ? `<div style="position:absolute;left:${view.x}px;top:${view.y}px;width:${view.width}px;height:${view.height}px;overflow:hidden"><div style="position:absolute;left:0;top:0;transform-origin:0 0;transform:scale(${zoom}) translate(${-camera.rect.x}px, ${-(camera.rect.y + view.y / zoom)}px)">${layers.clipped}</div></div>`
        : "";
    return `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; width: ${screen.width}px; height: ${screen.height}px; overflow: hidden; background: ${BOARD[theme].bg}; color-scheme: ${theme}; }
body { background-image: radial-gradient(${BOARD[theme].grid} 1.2px, transparent 1.2px); background-size: ${grid}px ${grid}px; }
#world { position: absolute; left: 0; top: 0; transform-origin: 0 0; transform: scale(${zoom}) translate(${-camera.rect.x}px, ${-camera.rect.y}px); }
.toolbar { position: absolute; left: 0; right: 0; top: 0; height: ${VIEW.toolbar}px; display: flex; align-items: center; gap: 10px; padding: 0 18px; box-sizing: border-box; font: 13px system-ui; color: ${theme === "dark" ? "#a1a1aa" : "#71717a"}; }
.minimap { position: absolute; left: 16px; bottom: 18px; width: 156px; height: 134px; border-radius: 10px; box-sizing: border-box; background: ${theme === "dark" ? "#232329" : "#fff"}; border: 1px solid ${theme === "dark" ? "#3f3f46" : "#e4e4e7"}; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
.toolbar i { width: 34px; height: 34px; border-radius: 9px; background: ${theme === "dark" ? "#27272a" : "#fff"}; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
</style></head><body><div id="world">${worldHtml(built, theme)}</div>${clipped}${layers.chrome ? `<div class="toolbar"><i></i><i></i><i></i><i></i><span style="margin-left:auto">usable view below this bar, left of the panel strip</span></div><div class="minimap"></div>` : ""}${layers.overlay ?? ""}</body></html>`;
};

/**
 * The PR Blackboard panel's webview in a 320 × 534 frame, showing `view`;
 * with `focus`, that element has focus once the view is in, and with
 * `click`, that button has been pressed (Rebuild or Clear asking).
 */
const panelFrame = (view: PanelView, theme: Theme, at: Point, focus?: string, click?: string) => {
    const then = [click ? `document.getElementById(${JSON.stringify(click)}).click();` : "", focus ? `document.getElementById(${JSON.stringify(focus)}).focus();` : ""].join("");
    const html = webviewHtml(themeCss(STYLING[theme])).replace(
        '<script type="module">',
        `<script>window.acquireDrawdyApi=()=>({postMessage(){},onMessage(f){setTimeout(()=>{f({type:"view",view:${JSON.stringify(view).replace(/</g, "\\u003c")}});${then}});return()=>{}}});</script><script type="module">`
    );
    return `<div style="position:absolute;left:${at.x}px;top:${at.y}px;width:320px;height:534px;border-radius:14px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.35);border:1px solid ${theme === "dark" ? "#34343a" : "#e4e4e7"}"><iframe srcdoc="${attr(html)}" style="width:320px;height:534px;border:0;display:block"></iframe></div>`;
};

const baseView = (review: Review): Omit<PanelView, "phase"> => {
    const label = `${review.pr.ref.owner}/${review.pr.ref.repo}#${review.pr.ref.number}`;
    return {
        loading: [],
        annotations: [],
        error: null,
        tag: { label, colour: projectColour(label) },
        pr: { title: segments(review.pr.title), state: review.pr.state, additions: review.pr.additions, deletions: review.pr.deletions },
        total: stepsOf(review).length,
        cards: review.pins.length,
        current: -1,
        hasPrevious: false,
        hasNext: false,
        card: null,
        rebuildCost: null,
        rebuilding: null,
    };
};

/** The reading view at `pin`, its link names in their strings' colours from the plan, as the board's marks give them. */
const readingView = (built: Built, pin: string, more: Partial<PanelView> = {}): PanelView => {
    const { review, plan } = built;
    const step = stepsOf(review).indexOf(pin);
    const colourOf = (link: string) => {
        const s = plan.strings.find((x) => x.link === link);
        return s ? (STRING_COLOURS as readonly string[]).indexOf(s.style.color) : null;
    };
    return {
        ...baseView(review),
        phase: "ready",
        current: step,
        hasPrevious: step > 0,
        hasNext: step < stepsOf(review).length - 1,
        card: currentCardOf(review, review.pins.find((x) => x.id === pin)!, colourOf, pin === "pr" ? warningsOf(review, undefined, null, 0) : []),
        ...more,
    };
};

/** A rough HTML rendering of a DOM schema, as Drawdy's SchemaElement draws one. */
const schemaHtml = (node: any): string => {
    const st = node.styles ?? {};
    const dim = (d?: [number, string]) => (d ? `${d[0]}${d[1]}` : "");
    const css = [
        st.width && `width:${dim(st.width)}`,
        st.height && `height:${dim(st.height)}`,
        st.padding && `padding:${dim(st.padding)}`,
        st.backgroundColor && `background:${st.backgroundColor}`,
        st.borderRadius && `border-radius:${dim(st.borderRadius)}`,
        st.overflow && `overflow:${st.overflow}`,
        st.borderWidth && `border:${dim(st.borderWidth)} solid ${st.borderColor ?? "transparent"}`,
        st.color && `color:${st.color}`,
        st.fontSize && `font-size:${dim(st.fontSize)}`,
        st.fontWeight && `font-weight:${({ normal: 400, medium: 500, semibold: 600, bold: 700 } as Record<string, number>)[st.fontWeight]}`,
        st.textAlign && `text-align:${st.textAlign}`,
        st.transform && `transform:${st.transform}`,
        "box-sizing:border-box",
    ].filter(Boolean);
    const kids = (node.children ?? []).map(schemaHtml).join("");
    const align = (a?: string) => ({ between: "space-between", start: "flex-start", center: "center", end: "flex-end", around: "space-around" })[a ?? ""] ?? "";
    switch (node.type) {
        case "row":
        case "column":
            css.push("display:flex", `flex-direction:${node.type}`, `gap:${st.gap ?? 0}px`, `justify-content:${align(st.mainAxisAlignment)}`, `align-items:${align(st.crossAxisAlignment)}`);
            return `<div style="${css.join(";")}">${kids}</div>`;
        case "button":
            css.push("border:0", "background:transparent", "display:flex", "align-items:center", "justify-content:center", "font:inherit");
            return `<button style="${css.join(";")}">${kids}</button>`;
        case "text":
            return `<div style="${css.join(";")}">${esc(node.child)}</div>`;
        case "iframe":
            return `<iframe srcdoc="${attr(node.child.srcDoc)}" style="${css.join(";")};display:block;border:0"></iframe>`;
        default:
            return `<div style="${css.join(";")}">${kids}</div>`;
    }
};

/**
 * Read all on the board where it opens, 24 right of `pin`, opened from the
 * panel at the first change, in canvas units: the pane of its schema, the
 * page scaled with the board. `moved` is where a drag took it.
 */
const readAllPane = (built: Built, pin: string, theme: Theme, moved: Point = { x: 0, y: 0 }) => {
    const { review, plan } = built;
    return paneAt(plan.pins.get(pin)!, { ...readAllOf(review.pins.find((x) => x.id === pin)!, review, theme, null), theme, pin }, moved);
};

/** A card's whole file in the same pane, as `View full file` opens it: the saved PR's file at the head commit, at the card's first line. */
const fullFilePane = (built: Built, pin: string, theme: Theme) => {
    const { review, plan, raw } = built;
    const p = review.pins.find((x) => x.id === pin)!;
    return paneAt(plan.pins.get(pin)!, { ...fullFileOf(p, review, raw.get(p.path!) ?? null, theme, SAID.chars, firstLineOf(plan.cards.get(pin)!)), theme, pin });
};

/** The pane beside a card, in canvas units, with its page. */
const paneAt = (card: Rect, page: Parameters<typeof popoverSchema>[0], moved: Point = { x: 0, y: 0 }) => {
    const at = readAllRect(card, page.height(VIEW.readAll.width));
    const rect = { ...at, x: at.x + moved.x, y: at.y + moved.y };
    const [pane] = (popoverSchema(page, rect, { clip: rect, transform: "none" }) as { children: DomElementSchema[] }).children;
    return { rect, html: `<div style="position:absolute;left:${rect.x}px;top:${rect.y}px;font-family:system-ui">${schemaHtml(pane)}</div>` };
};

const shots: string[] = [];
const shoot = (name: string, html: string, screen: Screen, theme: Theme = "light") => {
    const file = join(OUT, `${name}.html`);
    const png = join(OUT, `${name}.png`);
    writeFileSync(file, html);
    const args = [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        ...(theme === "dark" ? ["--force-dark-mode"] : []),
        "--virtual-time-budget=4000",
        `--window-size=${screen.width},${screen.height}`,
        "--force-device-scale-factor=2",
        `--screenshot=${png}`,
        `file://${file}`,
    ];
    // Headless Chrome may exit nonzero after writing the PNG, or exit before writing it: the file decides.
    for (let attempt = 1; ; attempt++) {
        rmSync(png, { force: true });
        spawnSync(CHROME, args, { stdio: "ignore" });
        if (existsSync(png) && statSync(png).size > 0) break;
        if (attempt === 3) throw new Error(`Chrome wrote no ${png} in 3 tries`);
    }
    shots.push(png);
};

/** A screen 2400 px wide, at most `maxHeight` tall, and the camera that shows `b` whole on it, centred, 40 px clear. */
const wholeView = (b: Rect, maxHeight = Infinity): { screen: Screen; camera: Camera } => {
    const width = 2400;
    const height = Math.round(Math.min(maxHeight, (width * (b.height + 160)) / (b.width + 160)));
    const zoom = Math.min((width - 80) / b.width, (height - 80) / b.height);
    return { screen: { width, height }, camera: { zoom, rect: { x: b.x - (width / zoom - b.width) / 2, y: b.y - (height / zoom - b.height) / 2, width: width / zoom, height: height / zoom } } };
};

const overview = (name: string, boards: Boards, theme: Theme) => {
    const built = boards[theme];
    const { screen, camera } = wholeView(built.plan.bounds, 2400);
    shoot(name, page(built, screen, camera, theme), screen, theme);
};

/** A step's close-up, at the step camera; with `pane`, Read all or the card's whole file open beside the card. */
const closeUp = (name: string, boards: Boards, pin: string, screen: Screen, theme: Theme, pane: "read-all" | "full-file" | null = null, view?: PanelView) => {
    const built = boards[theme];
    const rect = built.plan.pins.get(pin)!;
    const far = built.plan.strings.filter((s) => s.from.pin === pin || s.to.pin === pin).map((s) => (s.from.pin === pin ? s.to.pin : s.from.pin));
    const linked = far.map((id) => built.plan.pins.get(id)!);
    const names = far.map((id) => nameRect(built.plan.pins.get(id)!, built.review.pins.find((p) => p.id === id)!.name));
    const camera = stepCamera(rect, screen, null, linked, names)!;
    const panel = panelFrame(view ?? readingView(built, pin), theme, { x: screen.width - VIEW.panel + 10, y: VIEW.toolbar + 10 });
    if (!pane) return shoot(name, page(built, screen, camera, theme, { overlay: panel, chrome: true }), screen, theme);
    // The pane opens readable: the camera first comes to the card's right 240 and the pane when they aren't in view at 0.8 to 1.
    const open = pane === "read-all" ? readAllPane(built, pin, theme) : fullFilePane(built, pin, theme);
    const shown = readAllCamera(rect, open.rect, screen, camera.rect) ?? camera;
    shoot(name, page(built, screen, shown, theme, { clipped: open.html, overlay: panel, chrome: true }), screen, theme);
};

/** Read all with the board zoomed to `zoom` round it, as a reader zooms out, or after a drag of its header by `moved`. */
const readAllAt = (name: string, boards: Boards, pin: string, screen: Screen, theme: Theme, zoom: number, moved: Point = { x: 0, y: 0 }) => {
    const built = boards[theme];
    const pane = readAllPane(built, pin, theme, moved);
    const around = union([built.plan.pins.get(pin)!, pane.rect]);
    const view = usable(screen);
    const camera: Camera = {
        zoom,
        rect: { x: around.x + around.width / 2 - view.width / zoom / 2, y: around.y + around.height / 2 - (view.height / zoom) / 2 - view.y / zoom, width: screen.width / zoom, height: screen.height / zoom },
    };
    const panel = panelFrame(readingView(built, pin), theme, { x: screen.width - VIEW.panel + 10, y: VIEW.toolbar + 10 });
    shoot(name, page(built, screen, camera, theme, { clipped: pane.html, overlay: panel, chrome: true }), screen, theme);
};

/**
 * The board after a reader drags one card: Drawdy moves the ends of its
 * strings and keeps their bends, which DDP 1.3 can't change (3.3.4).
 */
const dragged = (name: string, boards: Boards, pin: string, by: Point, theme: Theme) => {
    const built = boards[theme];
    const id = built.elements.find((e) => e.type === "component" && (e.meta as any)?.prBlackboard?.pin === pin)!.drawdyElementId;
    const r = built.rects.get(id)!;
    const rects = new Map(built.rects).set(id, { ...r, x: r.x + by.x, y: r.y + by.y });
    const elements = built.elements.map((e) => (e.type === "component" && e.drawdyElementId === id ? { ...e, x: r.x + by.x, y: r.y + by.y } : e));
    const moved: Built = { ...built, elements, rects };
    const { screen, camera } = wholeView(union([built.plan.bounds, rects.get(id)!]));
    shoot(name, page(moved, screen, camera, theme), screen, theme);
};

/** What the reader sees once the board lands: the overview camera, the PR card current, the panel in its strip. */
const landed = (name: string, boards: Boards, screen: Screen, theme: Theme) => {
    const built = boards[theme];
    const code = [...built.plan.pins].filter(([id]) => id !== "pr").map(([, r]) => r);
    const camera = overviewCamera(overviewBounds(code, built.plan.pins.get("pr") ?? null)!, screen);
    const panel = panelFrame(readingView(built, "pr"), theme, { x: screen.width - VIEW.panel + 10, y: VIEW.toolbar + 10 });
    shoot(name, page(built, screen, camera, theme, { overlay: panel, chrome: true }), screen, theme);
};

/**
 * Links drawn and not; how often the strings cross, against straight strings
 * between the same ends (where strings share an end they meet, which is no
 * crossing); and how many crossing strings share a colour.
 */
const report = (name: string, built: Built) => {
    const { plan, review } = built;
    const paths = plan.strings;
    const lines = plan.strings.map((x) => ({ start: x.start, end: x.end, path: [x.start, x.end] }));
    const count = (list: Pick<PlannedString, "start" | "end" | "path">[]) => crossingsAmong(list, stringCrossings);
    const crossing = plan.strings.flatMap((a, i) => plan.strings.slice(i + 1).filter((b) => stringCrossings(a, b) > 0).map((b) => [a, b] as const));
    const alike = crossing.filter(([a, b]) => a.style.color === b.style.color);
    const fromOne = alike.filter(([a, b]) => a.from.pin === b.from.pin).length;
    console.log(
        `${name}: ${plan.strings.length} of ${review.links.length} links drawn, ${plan.undrawn.length} listed in the panel only; ${count(paths)} crossings (straight: ${count(lines)}); ${plan.strings.filter((x) => x.label).length} labels; ` +
            `${new Set(plan.strings.map((x) => x.style.color)).size} colours, ${alike.length} of ${crossing.length} crossing pairs share one (${fromOne} of them leave the same card)`
    );
};

/**
 * Each description as Chrome lays it out on the PR card, at its width, the
 * whole of it, beside `markdownHeight`'s estimate, which the card's height
 * holds: measured by a script in the page and read back with `--dump-dom`.
 */
const measure = (cards: [string, Review][]) => {
    const file = join(OUT, "measure.html");
    const css = `:root{--ink:#111;--ink2:#555;--md-border:#ddd;--md-code-bg:#f6f8fa;--bg:#fff;--bg2:#eee;--md-link:#0969da}*{box-sizing:border-box;margin:0;padding:0}code{font-family:ui-monospace,Menlo,monospace}${MARKDOWN_CSS}`;
    const blocks = cards.map(([name, review]) => `<div data-name="${name}" class="md" style="width:608px">${markdownHtml(lexMarkdown(review.pr.body), "card")}</div>`).join("");
    const script = `addEventListener("load",()=>{const out=[...document.querySelectorAll("div.md")].map(d=>[d.dataset.name,d.scrollHeight]);document.getElementById("out").textContent=JSON.stringify(out)});`;
    writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><pre id="out"></pre>${blocks}<script>${script}</script></body></html>`);
    // The page is in the output whatever Chrome's exit code.
    const dom = spawnSync(CHROME, ["--headless=new", "--disable-gpu", "--virtual-time-budget=4000", "--dump-dom", `file://${file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).stdout ?? "";
    const measured = new Map<string, number>(JSON.parse((/<pre id="out">([^<]*)<\/pre>/.exec(dom)?.[1] || "[]").replace(/&quot;/g, '"')));
    for (const [name, review] of cards) {
        const m = prCard(review);
        const whole = measured.get(name) ?? 0;
        const over = whole > 0 ? `${Math.round((m.estimate / whole - 1) * 100)}% over` : "not measured";
        console.log(`${name} description: ${whole} measured in Chrome, ${m.estimate} estimated (${over}), on a PR card ${m.width} × ${m.height}`);
    }
};

const SMALL: Screen = { width: 1280, height: 800 };
const LARGE: Screen = { width: 1920, height: 1080 };

// honojs/hono#5513
const honoSaved = honoFixture();
const hono = boardsOf(await reviewOf(honoSaved), honoSaved.raw);
report("hono#5513", hono.light);
overview("hono-overview", hono, "light");
overview("hono-overview-dark", hono, "dark");
landed("hono-1920-landed", hono, LARGE, "light");
landed("hono-1920-landed-dark", hono, LARGE, "dark");
// Description: the PR card current and the camera on it, as a step frames a card.
closeUp("hono-1920-pr", hono, "pr", LARGE, "light");
closeUp("hono-1280-pr-dark", hono, "pr", SMALL, "dark");
closeUp("hono-1920-dispatch", hono, "src/hono-base.ts:411", LARGE, "light");
closeUp("hono-1280-dispatch", hono, "src/hono-base.ts:411", SMALL, "light");
closeUp("hono-1920-toerror-dark", hono, "src/compose.ts:4", LARGE, "dark");
closeUp("hono-1920-toerror-read-all-dark", hono, "src/compose.ts:4", LARGE, "dark", "read-all");
closeUp("hono-1920-compose-read-all", hono, "src/compose.ts:18", LARGE, "light", "read-all");
closeUp("hono-1280-compose-read-all", hono, "src/compose.ts:18", SMALL, "dark", "read-all");
// View full file: the whole file at the head commit in the same pane, at the card's first line; hono.test.ts is 3,934 lines long.
closeUp("hono-1920-compose-full-file", hono, "src/compose.ts:18", LARGE, "light", "full-file");
closeUp("hono-1920-hono-test-full-file-dark", hono, "test:src/hono.test.ts", LARGE, "dark", "full-file");
// Read all is on the board: zoomed out it shrinks with the cards, and a drag of its header moves it.
readAllAt("hono-1600-compose-read-all-0.8-light", hono, "src/compose.ts:18", { width: 1600, height: 900 }, "light", 0.8);
readAllAt("hono-1600-compose-read-all-0.4-dark", hono, "src/compose.ts:18", { width: 1600, height: 900 }, "dark", 0.4);
readAllAt("hono-1600-compose-read-all-dragged-light", hono, "src/compose.ts:18", { width: 1600, height: 900 }, "light", 0.8, { x: -300, y: 260 });
closeUp("hono-1920-tests", hono, "test:src/compose.test.ts", LARGE, "light");
closeUp("hono-1920-hono-test", hono, "test:src/hono.test.ts", LARGE, "light");
closeUp("hono-1920-bottom-row", hono, "src/hono-base.ts:276", LARGE, "light");
dragged("hono-dragged", hono, "src/compose.ts:18", { x: 200, y: 0 }, "light");

// A description five times hono's: the PR card grows down its own column, and the board lands framing the code.
const honoReview = hono.light.review;
const tall = boardsOf({ ...honoReview, pr: { ...honoReview.pr, body: Array.from({ length: 5 }, (_, i) => `## Part ${i + 1}\n\n${honoReview.pr.body}`).join("\n\n") } });
report("hono#5513, five descriptions", tall.light);
overview("tall-overview", tall, "light");
landed("tall-1600-landed", tall, { width: 1600, height: 900 }, "light");

// excalidraw/excalidraw#12237: the stress case for strings and Markdown.
const excalidraw = boardsOf(await reviewOf(excalidrawFixture()));
report("excalidraw#12237", excalidraw.light);
overview("excalidraw-overview", excalidraw, "light");
overview("excalidraw-overview-dark", excalidraw, "dark");
closeUp("excalidraw-1920-pr", excalidraw, "pr", LARGE, "light");
// A tall step pulled toward names up and right: its gutter stays clear of the minimap.
closeUp("excalidraw-1920-pointer-move-dark", excalidraw, "packages/excalidraw/components/App.tsx:6808", LARGE, "dark");
closeUp("excalidraw-1280-pointer-move", excalidraw, "packages/excalidraw/components/App.tsx:6808", SMALL, "light");
landed("excalidraw-1920-landed-dark", excalidraw, LARGE, "dark");

// The panel's states, dark above light. A state with focus has a page of its own per theme, since one frame in a page can have focus.
const loadingLines: PanelView["loading"] = [
    { key: "pr", label: "Reading the PR", state: "done", meta: "0.4 s" },
    {
        key: "files",
        label: "Reading 4 changed files",
        state: "active",
        meta: "2 / 4",
        rows: [
            { label: "src/compose.test.ts", state: "done", file: true },
            { label: "src/compose.ts", state: "done", file: true },
            { label: "src/hono-base.ts", state: "active", file: true },
            { label: "src/hono.test.ts", state: "todo", file: true },
        ],
    },
    { key: "link", label: "Finding the lines", state: "todo" },
    { key: "pin", label: "Pinning the cards", state: "todo" },
];
const start: PanelView = { ...baseView(hono.light.review), phase: "start", tag: null, pr: null };
const resize = excalidraw.light.review.pins.find((p) => p.name === "maybeHandleResize()")!.id;
const LIMITED = "This network has used GitHub's 60 requests for this hour. Try again in 12 minutes.";
const states: [PanelView, string?][] = [
    [start],
    [{ ...start, error: "Only GitHub PR links work, like github.com/owner/repo/pull/123." }],
    [{ ...baseView(hono.light.review), phase: "loading", loading: loadingLines, pr: null }],
    [readingView(hono.light, "pr")],
    [readingView(hono.light, "src/hono-base.ts:411")],
    [readingView(hono.light, "src/compose.ts:18")],
    [readingView(hono.light, "src/compose.ts:18", { rebuilding: "Reading 4 changed files" })],
    [readingView(hono.light, "src/compose.ts:18", { rebuildCost: { files: 2188, requests: 23 } }), "rebuild"],
    [readingView(hono.light, "src/compose.ts:18"), "clear"],
    [readingView(hono.light, "src/compose.ts:18", { error: LIMITED })],
    [readingView(excalidraw.light, "pr")],
    [readingView(excalidraw.light, resize)],
    [{ ...start, error: LIMITED }],
];
const rows = (["dark", "light"] as Theme[]).map((theme, r) => states.map(([view, click], i) => panelFrame(view, theme, { x: 20 + i * 350, y: 20 + r * 574 }, undefined, click)).join("")).join("");
shoot("panel-states", `<!doctype html><html><body style="margin:0;background:#8a8a90;width:${20 + states.length * 350}px;height:1148px">${rows}</body></html>`, { width: 20 + states.length * 350, height: 1148 });
const single = (name: string, view: PanelView, theme: Theme, focus?: string) =>
    shoot(name, `<!doctype html><html><body style="margin:0;background:#8a8a90;width:370px;height:574px">${panelFrame(view, theme, { x: 20, y: 20 }, focus)}</body></html>`, { width: 370, height: 574 });
for (const theme of ["dark", "light"] as Theme[]) {
    // Home: the start view, its field focused.
    single(`panel-home-${theme}`, start, theme, "start-url");
    // Keyboard focus on Rebuild: its tooltip at once, and the ring that reads on white too.
    single(`panel-focus-${theme}`, readingView(hono.light, "src/compose.ts:18"), theme, "rebuild");
}

// A made-up pull request with two threads, a cycle, tests, docs and a description with every Markdown block.
const synthetic = boardsOf(await reviewOf(twoThreads()));
report("two threads", synthetic.light);
overview("synthetic-overview", synthetic, "light");
closeUp("synthetic-1920-pr", synthetic, "pr", LARGE, "dark");
closeUp("synthetic-1920-thread-2", synthetic, "src/render.ts:12", LARGE, "light");

// A board at the 32-card limit, the PR card counting what it left off.
const full = boardsOf(await reviewOf(crowded()));
report("32 cards", full.light);
overview("synthetic-32-overview", full, "dark");

// Saved pull requests given on the command line, such as the Try examples.
const saved: [string, Review][] = [];
for (const path of SAVED) {
    const f = savedPr(path);
    const name = `${f.pr.ref.repo}#${f.pr.ref.number}`;
    const boards = boardsOf(await reviewOf(f), f.raw);
    report(name, boards.light);
    overview(`saved-${f.pr.ref.repo}-${f.pr.ref.number}`, boards, "light");
    overview(`saved-${f.pr.ref.repo}-${f.pr.ref.number}-dark`, boards, "dark");
    closeUp(`saved-${f.pr.ref.repo}-${f.pr.ref.number}-pr`, boards, "pr", LARGE, "dark");
    // The panel as the board lands, the description whole, in each theme.
    for (const theme of ["dark", "light"] as Theme[]) single(`saved-${f.pr.ref.repo}-${f.pr.ref.number}-panel-${theme}`, readingView(boards[theme], "pr"), theme);
    // View full file on the change card in the longest file, as the step camera shows it.
    const { review } = boards.light;
    const linesOf = (pin: { path?: string }) => review.files.find((x) => x.path === pin.path)?.lines ?? 0;
    const longest = review.pins.filter((p) => p.kind === "change" && f.raw.has(p.path!)).sort((a, b) => linesOf(b) - linesOf(a))[0];
    if (longest) for (const theme of ["light", "dark"] as Theme[]) closeUp(`saved-${f.pr.ref.repo}-${f.pr.ref.number}-full-file-${theme}`, boards, longest.id, LARGE, theme, "full-file");
    saved.push([name, boards.light.review]);
}

measure([["hono#5513", hono.light.review], ["excalidraw#12237", excalidraw.light.review], ["two threads", synthetic.light.review], ["32 cards", full.light.review], ...saved]);

console.log(`Wrote ${shots.length} screenshots to ${OUT}:`);
for (const s of shots) console.log(`  ${s}`);
