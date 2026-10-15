/**
 * Read all, the one popover: a code card's whole declaration, or a test or
 * file card's whole diff, under the card's own header.
 */

import { sumBy } from "../fp.ts";
import { escapeHtml } from "../highlight.ts";
import type { Pin, Review } from "../model.ts";
import { CARD, expandTabs, gutterOf, isDeclaration, type Row } from "./grid.ts";
import { cardCss, headerHtml, page, rowsHtml } from "./html.ts";
import { declFileOf, declarationRows, fileDiffRows } from "./rows.ts";

/** A page for Read all, and how tall it lays out at a width, estimated from its rows, so the pane is no taller than its page. */
export type ReadAllPage = { html: string; height: (width: number) => number };

/**
 * How many rows a code line takes in Read all, whose code column is `room`
 * wide: one, and more for a long line, each part after the first starting
 * under the line's indent plus two columns.
 */
export const wrapCount = (line: string, room: number): number => {
    const text = expandTabs(line);
    const fits = Math.max(1, Math.floor((room - CARD.codePad) / CARD.charWidth));
    if (text.length <= fits) return 1;
    const hang = /^ */.exec(text)![0].length + 2;
    return 1 + Math.ceil((text.length - fits) / Math.max(8, fits - hang));
};

const wrappedRows = (r: Row, room: number): number => (r.kind === "line" ? wrapCount(r.line.text, room) : 1);

/** Room Read all's header keeps on its right for the pane's `✕`. */
const CLOSE_ROOM = 56;

export const readAllCss = () => `
html { overflow: auto; overscroll-behavior: contain; }
body { height: auto; overflow: visible; }
header { position: sticky; top: 0; z-index: 1; padding-right: ${CLOSE_ROOM}px; }
.r { height: auto; min-height: ${CARD.row}px; white-space: pre-wrap; }
.r > code { overflow: visible; text-overflow: clip; overflow-wrap: anywhere; user-select: text; }
.r:hover { box-shadow: inset 0 0 0 999px var(--hover); }
.fold, .gap { padding-left: 14px; }
`;

/**
 * Scrolls Read all to the lines in focus, or the first change, a third of
 * the way down, with a whole row under the header. Runs inside its iframe.
 * Drawdy lays the pane out after the page starts, which resets the
 * scroll, so it scrolls again on each resize for two seconds, until the
 * reader scrolls, clicks or types. It sets its own scroller's `scrollTop`:
 * `scrollIntoView` would also scroll the pages around the iframe.
 */
export const readAllScript = () => {
    const go = () => {
        const target = document.querySelector(".focus") ?? document.querySelector(".r.add, .r.del");
        const root = document.scrollingElement ?? document.documentElement;
        const head = document.querySelector("header")?.getBoundingClientRect().height ?? 0;
        if (!target || root.clientHeight <= 0) return;
        const docTop = (el: Element) => el.getBoundingClientRect().top + root.scrollTop - head;
        const wanted = docTop(target) - (root.clientHeight - head) / 3;
        const row = [...document.querySelectorAll("body > div > *")].find((el) => docTop(el) >= wanted - 0.5);
        root.scrollTop = Math.max(0, row ? docTop(row) : wanted);
    };
    const watch = new ResizeObserver(go);
    watch.observe(document.documentElement);
    const stop = () => watch.disconnect();
    for (const type of ["wheel", "pointerdown", "keydown", "touchstart"]) window.addEventListener(type, stop, { once: true });
    setTimeout(stop, 2000);
    go();
};

const readAllRows = (pin: Pin, review: Pick<Review, "files" | "links">): Row[] => {
    if (isDeclaration(pin)) {
        const f = declFileOf(pin, review);
        return f ? declarationRows(pin, f, review) : [];
    }
    const file = review.files.find((f) => f.path === pin.path);
    return file ? fileDiffRows(file) : [];
};

/** Read all for a code card: unified, wrapped, changed words marked, opened at head line `focus` or the first change. The PR card has none: it shows its whole description. */
export const readAllOf = (pin: Pin, review: Pick<Review, "files" | "links">, focus: number | null): ReadAllPage => {
    const rows = readAllRows(pin, review);
    const look = { plain: pin.kind === "context", wrap: true };
    return {
        html: page(cardCss() + readAllCss(), headerHtml(pin) + rowsHtml(rows, look, focus), { script: `(${readAllScript.toString()})();` }),
        height: (width) => CARD.header + sumBy(rows, (r) => wrappedRows(r, width - gutterOf(pin)) * CARD.row) + CARD.padBottom,
    };
};

/** The pane with a line of words under its header, while a page loads or why it couldn't: `css` adds to Read all's own. */
export const notePage = (header: string, text: string, css = ""): ReadAllPage => ({
    html: page(
        cardCss() + readAllCss() + css + ".note { padding: 16px 14px; color: var(--ink2); font-size: 13px; line-height: 18px; }",
        `${header}<p class="note">${escapeHtml(text)}</p>`
    ),
    // The note's padding, 16 above and below and 14 at each side; 18 px lines, 13 px sans running about 7 px a character.
    height: (width) => CARD.header + 32 + Math.ceil((text.length * 7) / (width - 28)) * 18,
});

/** Read all while the review loads, or why it couldn't: the card's name in the header, then the line. */
export const readAllMessage = (name: string, text: string): ReadAllPage => notePage(`<header><span class="name">${escapeHtml(name)}</span></header>`, text);
