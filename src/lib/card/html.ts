/** Cards as the HTML pages their iframes show. */

import { count, plural } from "../fp.ts";
import { escapeHtml } from "../highlight.ts";
import type { Pin } from "../model.ts";
import { CARD, expandTabs, headerName, isDeclaration, type CardModel, type Row } from "./grid.ts";

export type Theme = "light" | "dark";

/**
 * Card colours, per theme. Diff, syntax and Markdown colours are GitHub's
 * (Primer), so code reads as it does on GitHub. Read all's frame and its
 * buttons take theirs from here too, so it matches the cards.
 */
export const PALETTES: Record<Theme, Record<string, string>> = {
    light: {
        bg: "#ffffff", bg2: "#f4f4f5", ink: "#18181b", ink2: "#52525b", ink3: "#8a8a93", line: "#e4e4e7", hover: "rgb(24 24 27 / .05)",
        "add-bg": "#e6ffec", "add-gut": "#ccffd8", add: "#1a7f37", "del-bg": "#ffebe9", "del-gut": "#ffd7d5", del: "#c4232e",
        "add-mark": "#abf2bc", "del-mark": "rgb(255 129 130 / .4)", blue: "#4a6ee0",
        k: "#cf222e", s: "#0a3069", n: "#0550ae", c: "#59636e", f: "#8250df", t: "#953800",
        "md-link": "#0969da", "md-code-bg": "#f6f8fa", "md-border": "#d1d9e0",
    },
    dark: {
        bg: "#1f1f23", bg2: "#27272b", ink: "#f4f4f5", ink2: "#b4b4bc", ink3: "#85858f", line: "#34343a", hover: "rgb(255 255 255 / .06)",
        "add-bg": "rgb(46 160 67 / .15)", "add-gut": "rgb(63 185 80 / .3)", add: "#5bd178", "del-bg": "rgb(248 81 73 / .1)", "del-gut": "rgb(248 81 73 / .3)", del: "#ff8079",
        "add-mark": "rgb(46 160 67 / .4)", "del-mark": "rgb(248 81 73 / .4)", blue: "#8aa4ff",
        k: "#ff7b72", s: "#a5d6ff", n: "#79c0ff", c: "#9198a1", f: "#d2a8ff", t: "#ffa657",
        "md-link": "#4493f8", "md-code-bg": "#151b23", "md-border": "#3d444d",
    },
};

/**
 * Colours for a theme, fixed in the page. A card's iframe can't follow
 * Drawdy's theme: its `prefers-color-scheme` follows the browser's, which
 * often differs, so the card takes the theme Drawdy showed when it was pinned.
 */
const themeVars = (theme: Theme) => `:root { color-scheme: ${theme}; ${Object.entries(PALETTES[theme]).map(([k, v]) => `--${k}: ${v};`).join(" ")} }`;

const BASE_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--ink); }
body { font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.mono, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
.a { color: var(--add); } .d { color: var(--del); }
`;

/** The CSS of every card page. A function, so the parser worker, which renders no card, leaves it out. */
export const cardCss = (): string => `
header { height: ${CARD.header}px; display: flex; align-items: center; gap: 10px; padding: 0 14px; background: var(--bg2); border-bottom: 1px solid var(--line); white-space: nowrap; }
.name { flex: none; max-width: 52%; font: 600 15px/1 ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; }
.chip { flex: none; border-radius: 6px; padding: 3px 7px; font: 700 10.5px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .06em; }
.chip.new { background: var(--add-gut); color: var(--add); } .chip.unchanged { background: var(--line); color: var(--ink2); } .chip.test { background: var(--blue); color: var(--bg); }
.where { min-width: 0; flex: 1; text-align: right; color: var(--ink3); font: 12px ui-monospace, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; }
.counts { flex: none; font: 500 12.5px ui-monospace, Menlo, monospace; }
.r { height: ${CARD.row}px; line-height: ${CARD.row}px; display: grid; grid-template-columns: 44px 44px 20px 16px 1fr; white-space: pre; overflow: hidden; font: 12.5px/${CARD.row}px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
.r > i { font-style: normal; text-align: right; padding-right: 8px; color: var(--ink3); font-size: 11.5px; }
.r > b { font-weight: 400; text-align: center; color: var(--ink3); }
.r > u { text-decoration: none; color: var(--ink); font-weight: 700; text-align: center; }
.r > code { overflow: hidden; text-overflow: ellipsis; padding-right: 12px; }
.add { background: var(--add-bg); } .add > i { background: var(--add-gut); } .add > b { color: var(--add); }
.del { background: var(--del-bg); } .del > i { background: var(--del-gut); } .del > b { color: var(--del); }
.plain .r { grid-template-columns: 52px 16px 1fr; color: var(--ink2); }
.gap, .fold, .info { height: ${CARD.row}px; line-height: ${CARD.row}px; padding: 0 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--ink3); font-size: 11.5px; }
.fold, .gap { font-family: ui-monospace, Menlo, monospace; padding-left: 112px; }
.fold.cases { padding-left: 52px; }
.ra { color: var(--ink2); text-decoration: underline; text-underline-offset: 2px; }
.dots { font: 15px/1 ui-sans-serif, system-ui, sans-serif; }
.info { color: var(--ink2); font-size: 12.5px; }
.case { height: ${CARD.row}px; line-height: ${CARD.row}px; padding-right: 14px; display: grid; grid-template-columns: 44px 20px 1fr; white-space: nowrap; overflow: hidden; font-size: 12.5px; }
.case > i { font-style: normal; text-align: right; padding-right: 8px; color: var(--ink3); font: 11.5px/${CARD.row}px ui-monospace, Menlo, monospace; }
.case > b { font-weight: 400; text-align: center; }
.case > span { overflow: hidden; text-overflow: ellipsis; }
.case.group > span { font-weight: 600; }
.case.removed { color: var(--ink3); text-decoration: line-through; }
.k { color: var(--k); } .s { color: var(--s); } .n { color: var(--n); } .c { color: var(--c); font-style: italic; } .f { color: var(--f); } .t { color: var(--t); }
mark { color: inherit; border-radius: 3px; background: var(--add-mark); }
.del mark { background: var(--del-mark); }
body.context { border: 1.5px dashed var(--ink3); border-radius: 12px; }
body.context header { background: transparent; color: var(--ink2); }
`;

const DOTS = `<span class="dots">⋯</span>`;
const READ_ALL = `<span class="ra">Read all</span>`;

/** Every fold row opens Read all, so each underlines what to click: its line count, or `Read all` on the last. */
const foldText = (r: Extract<Row, { kind: "fold" }>) => {
    if (r.cut) return `${DOTS} ${plural(r.count, "line")} cut short · ${READ_ALL}`;
    if (r.tail) return `${DOTS} ${plural(r.count, r.more ? "more line" : "line")} · ${READ_ALL}`;
    return `${DOTS} <span class="ra">${plural(r.count, "line")}</span>`;
};

/** How rows look: `plain` on an unchanged caller's card, with no +/− gutter; `wrap` in Read all, which wraps long lines; `focus` on the line Read all opens at. */
export type RowLook = { plain: boolean; wrap?: boolean; focus?: boolean };

/** Read all wraps long lines; each wrapped part starts under its line's own indent, two columns in. */
const hanging = (text: string) => {
    const at = /^ */.exec(expandTabs(text))![0].length + 2;
    return ` style="padding-left:${at}ch;text-indent:-${at}ch"`;
};

const lineHtml = ({ line: l, html, call }: Extract<Row, { kind: "line" }>, { plain, wrap, focus }: RowLook): string => {
    const arrow = call ? "→" : "";
    const code = `<code${wrap ? hanging(l.text) : ""}>${html || " "}</code>`;
    const r = focus ? "r focus" : "r";
    if (plain) return `<div class="${r} ctx" data-at="${l.at}"><i>${l.n ?? ""}</i><u>${arrow}</u>${code}</div>`;
    const sign = l.t === "add" ? "+" : l.t === "del" ? "−" : "";
    return `<div class="${r} ${l.t}" data-at="${l.at}"><i>${l.o ?? ""}</i><i>${l.n ?? ""}</i><b>${sign}</b><u>${arrow}</u>${code}</div>`;
};

const caseHtml = ({ test: t, depth }: Extract<Row, { kind: "case" }>): string => {
    const indent = depth > 0 ? ` style="padding-left:${depth * 12}px"` : "";
    return `<div class="case${t.group ? " group" : ""}${t.t === "del" ? " removed" : ""}"><i>${t.at}</i><b class="${t.t === "add" ? "a" : "d"}">${t.t === "add" ? "+" : "−"}</b><span${indent}>${escapeHtml(t.name)}</span></div>`;
};

const rowHtml = (row: Row, look: RowLook): string => {
    switch (row.kind) {
        case "gap":
            return `<div class="gap">${DOTS} ${plural(row.count, "line")}</div>`;
        case "fold":
            return `<div class="fold">${foldText(row)}</div>`;
        case "info":
            // A test card's last row opens Read all as a fold row does, so it looks like one, under the case names.
            return row.readAll ? `<div class="fold cases">${DOTS} ${escapeHtml(row.text).replace("Read all", READ_ALL)}</div>` : `<div class="info">${escapeHtml(row.text)}</div>`;
        case "case":
            return caseHtml(row);
        case "line":
            return lineHtml(row, look);
    }
};

/** A card's rows; `focusAt`: the head line Read all opens at. */
export const rowsHtml = (rows: readonly Row[], look: RowLook, focusAt: number | null = null): string =>
    `<div class="${look.plain ? "plain" : ""}">${rows.map((r) => rowHtml(r, { ...look, focus: r.kind === "line" && r.line.at === focusAt })).join("")}</div>`;

export const page = (css: string, body: string, theme: Theme, { script = "", bodyClass = "" } = {}): string =>
    `<!doctype html><html><head><meta charset="utf-8"><style>${themeVars(theme)}${BASE_CSS}${css}</style></head><body${bodyClass ? ` class="${bodyClass}"` : ""}>${body}${script ? `<script>${script}</script>` : ""}</body></html>`;

/** The card's chip, when it has one: changed code needs none. */
export const chipOf = (pin: Pick<Pin, "kind" | "status">): "NEW" | "UNCHANGED" | "TESTS" | null =>
    pin.kind === "test" ? "TESTS" : pin.kind === "context" ? "UNCHANGED" : pin.status === "new" && pin.kind !== "pr" ? "NEW" : null;

const CHIP_CLASS = { NEW: "new", UNCHANGED: "unchanged", TESTS: "test" } as const;

/** Where a card's code is, by its path in the repo: `src/hono-base.ts · 411–471`. */
export const whereOf = (pin: Pin): string => {
    if (!pin.path) return "";
    return isDeclaration(pin) ? `${pin.path} · ${pin.from}–${pin.to}` : pin.path;
};

/** A card's header: the name, its chip, where it is and `+N −M`. Read all opens with the same one, `✕` drawn over its right end. */
export const headerHtml = (pin: Pin, name = pin.name): string => {
    const chip = chipOf(pin);
    const counts = pin.kind === "context" ? "" : `<span class="counts"><span class="a">+${count(pin.add)}</span> <span class="d">−${count(pin.del)}</span></span>`;
    return `<header><span class="name">${escapeHtml(name)}</span>${chip ? `<span class="chip ${CHIP_CLASS[chip]}">${chip}</span>` : ""}<span class="where">${escapeHtml(whereOf(pin))}</span>${counts}</header>`;
};

export const cardHtml = (card: CardModel, pin: Pin, theme: Theme): string => {
    const plain = pin.kind === "context";
    return page(cardCss(), headerHtml(pin, headerName(pin, card.width)) + rowsHtml(card.rows, { plain }), theme, { bodyClass: plain ? "context" : "" });
};
