/**
 * A card's whole file at the PR's head commit, in the Read all pane: every
 * line with its number, the PR's added lines marked as the cards mark them,
 * the card's own lines along a rail, opened at the card's first line.
 */

import { textLines } from "../diff.ts";
import { count, plural, sumBy } from "../fp.ts";
import { escapeHtml, highlightLine, type HighlightState } from "../highlight.ts";
import { languageOf } from "../language.ts";
import type { Pin, Review } from "../model.ts";
import { VIEW } from "../view.ts";
import { CARD, expandTabs, isDeclaration, type CardModel } from "./grid.ts";
import { cardCss, page, type Theme } from "./html.ts";
import { changedStretches, highlightMarked } from "./lines.ts";
import { notePage, readAllCss, readAllScript, wrapCount, type ReadAllPage } from "./read-all.ts";

/** What the page reads of a review: the head commit and the file's diff. */
export type FullFileInput = Pick<Review, "pr" | "files">;

/** The sign column, between the line numbers and the code. */
const SIGN = 20;

/** The number column: as wide as the cards' for files under 10,000 lines, wider past that. */
const numberWidth = (lines: number) => Math.max(44, String(lines).length * 7 + 16);

/**
 * The page's CSS. Its rows are `<p>`s and its colours short tags (`<k>` for
 * `<span class="k">`), so a long file's page stays small: Drawdy is sent the
 * whole pane again on every camera move.
 */
const fullFileCss = () => `
header.file .path { display: flex; min-width: 0; font: 600 15px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
header.file .dir { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--ink3); font-weight: 400; }
header.file .base { flex: none; }
header.file .where { flex: none; margin-left: auto; }
.lines { padding-bottom: ${CARD.padBottom}px; }
.lines > p { display: grid; grid-template-columns: var(--num) ${SIGN}px 1fr; min-height: ${CARD.row}px; white-space: pre-wrap; font: 12.5px/${CARD.row}px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
.lines > p:hover { box-shadow: inset 0 0 0 999px var(--hover); }
.lines > p > i { font-style: normal; text-align: right; padding-right: 8px; color: var(--ink3); font-size: 11.5px; user-select: none; }
.lines > p > b { grid-column: 2; font-weight: 400; text-align: center; user-select: none; }
.lines > p > code { grid-column: 3; padding-right: ${CARD.codePad}px; overflow-wrap: anywhere; }
.lines > p.own > i { color: var(--ink2); box-shadow: inset 3px 0 0 var(--ink3); }
k { color: var(--k); } s { color: var(--s); text-decoration: none; } n { color: var(--n); } c { color: var(--c); font-style: italic; } f { color: var(--f); } t { color: var(--t); }
`;

/** The highlighter's `<span class="k">x</span>` as `<k>x</k>`: it never nests them. */
const shortTags = (html: string) => html.replace(/<span class="([a-z])">([^<]*)<\/span>/g, "<$1>$2</$1>");

/** The pane's header: the file's path, its folders muted and cut first, and the head commit it comes from. */
const fileHeader = (path: string, sha: string, lines?: number): string => {
    const cut = path.lastIndexOf("/") + 1;
    const dir = cut > 0 ? `<span class="dir">${escapeHtml(path.slice(0, cut))}</span>` : "";
    const where = `PR head ${sha.slice(0, 7)}${lines === undefined ? "" : ` · ${plural(lines, "line")}`}`;
    return `<header class="file"><span class="path">${dir}<span class="base">${escapeHtml(path.slice(cut))}</span></span><span class="where">${where}</span></header>`;
};

/** The pane with a line of words under the file's header: while the file loads, or why it can't show. */
export const fullFileMessage = (path: string, sha: string, text: string, theme: Theme): ReadAllPage => notePage(fileHeader(path, sha), text, theme, fullFileCss());

/** The head line a card starts at: its first code row's, or its first test case's. */
export const firstLineOf = (card: CardModel): number | null => {
    for (const r of card.rows) {
        if (r.kind === "line") return r.line.n ?? r.line.at;
        if (r.kind === "case") return r.test.at;
    }
    return null;
};

/** The lines a card stands for, which the rail marks: a declaration's, or a file card's ranges. A card about its whole file has none. */
const ownRanges = (pin: Pin): { from: number; to: number }[] => (isDeclaration(pin) ? [{ from: pin.from, to: pin.to }] : (pin.ranges ?? []));

/** Whether a text is a binary file's: git's own test, a NUL in its first 8,000 characters. */
const isBinary = (text: string) => text.slice(0, 8000).includes("\u0000");

/**
 * The whole file in the pane, or why it can't show: not read, not text,
 * longer than `maxChars`, or empty. `text` is the file at the head commit,
 * null when GitHub didn't send it; `focus` the head line the pane opens at.
 */
export const fullFileOf = (pin: Pin, review: FullFileInput, text: string | null, theme: Theme, maxChars: number, focus: number | null): ReadAllPage => {
    const path = pin.path ?? "";
    const sha = review.pr.headSha;
    const note = (words: string) => fullFileMessage(path, sha, words, theme);
    if (text === null) return note("PR Blackboard couldn't read this file from GitHub. Try again in a moment.");
    // A binary file says it is not text, whatever its length.
    if (isBinary(text)) return note("This file isn't text, so PR Blackboard can't show it.");
    if (text.length > maxChars) return note(`This file is ${count(text.length)} characters long, and PR Blackboard shows files up to ${count(maxChars)}.`);
    const lines = textLines(text).map((l) => expandTabs(l.endsWith("\r") ? l.slice(0, -1) : l));
    if (lines.length === 0) return note("This file is empty.");

    const file = review.files.find((f) => f.path === path);
    const lang = file?.lang ?? languageOf(path);
    // The PR's added lines by head line, each edit's changed words as the cards mark them.
    const added = new Map<number, [number, number] | null>();
    for (const h of file?.hunks ?? []) {
        const marks = changedStretches(h.lines);
        for (const l of h.lines) if (l.t === "add" && l.n !== undefined) added.set(l.n, marks.get(l) ?? null);
    }
    const own = ownRanges(pin);
    const target = focus !== null && focus >= 1 && focus <= lines.length ? focus : ([...added.keys()].sort((a, b) => a - b)[0] ?? null);
    const num = numberWidth(lines.length);
    // Lines that may wrap in the pane, with a few characters to spare for the estimate.
    const room = VIEW.readAll.width - num - SIGN - 4 * CARD.charWidth;
    const state: HighlightState = { inBlock: false };

    const rows = lines.map((line, i) => {
        const n = i + 1;
        const isAdded = added.has(n);
        const mark = added.get(n) ?? null;
        const html = shortTags(mark ? highlightMarked(line, lang, state, mark) : highlightLine(line, lang, state));
        const classes = [isAdded ? "add" : "", own.some((r) => n >= r.from && n <= r.to) ? "own" : "", n === target ? "focus" : ""].filter(Boolean).join(" ");
        // A line that wraps continues under its own indent, two columns in; a short one needs no style for that.
        const indent = /^ */.exec(line)![0].length + 2;
        const hang = wrapCount(line, room) > 1 ? ` style="padding-left:${indent}ch;text-indent:-${indent}ch"` : "";
        return `<p${classes ? ` class="${classes}"` : ""}><i>${n}</i>${isAdded ? "<b>+</b>" : ""}<code${hang}>${html || " "}</code></p>`;
    });
    return {
        html: page(cardCss() + readAllCss() + fullFileCss(), `${fileHeader(path, sha, lines.length)}<div class="lines" style="--num:${num}px">${rows.join("")}</div>`, theme, {
            script: `(${readAllScript.toString()})();`,
        }),
        height: (width) => CARD.header + sumBy(lines, (line) => wrapCount(line, width - num - SIGN)) * CARD.row + CARD.padBottom,
    };
};
