/**
 * The cards pinned on the board, and Read all, the one popover. A card is a
 * fixed grid kept as data (`card/grid.ts`), its rows chosen by its kind
 * (`card/rows.ts`), and shown as an HTML page (`card/html.ts`,
 * `card/pr.ts`); the popover shows a page of its own (`card/read-all.ts`,
 * `card/full-file.ts`).
 */

import { CARD, NAME, expandTabs, gutterOf, isDeclaration, opensReadAll, type CardModel, type Row } from "./card/grid.ts";
import { outgoing, rowsOf, type CardInput } from "./card/rows.ts";
import { clamp } from "./fp.ts";
import { typedMethods } from "./language.ts";
import type { Pin } from "./model.ts";

export { CARD, foldAt, foldsOf, fullFileRow, nameRect, onRow, rowMiddle, type CardModel, type Fold, type Row } from "./card/grid.ts";
export { PALETTES, cardHtml, chipOf, whereOf, type Theme } from "./card/html.ts";
export { linkGroups, wordOf } from "./card/links.ts";
export { prCard, prCardHtml, unpinnedText } from "./card/pr.ts";
export { firstLineOf, fullFileMessage, fullFileOf } from "./card/full-file.ts";
export { readAllMessage, readAllOf, type ReadAllPage } from "./card/read-all.ts";

/** About how many characters wide a row runs. */
const rowChars = (r: Row): number => {
    switch (r.kind) {
        case "line":
            return expandTabs(r.line.text).length;
        case "case":
            return r.test.name.length + 10 + r.depth * 2;
        case "info":
            return r.text.length * 0.9;
        default:
            return 0;
    }
};

/** How wide a card must be to show a row whole. */
const rowWidth = (r: Row): number => CARD.gutter + rowChars(r) * CARD.charWidth + 32;

/** How wide a card's header asks it to be; a typed method's card fits its whole name, as `headerName` measures it. */
const headerWidth = (pin: Pin): number => {
    const header = 220 + (pin.name.length + (pin.path ?? "").length) * 7;
    const named = isDeclaration(pin) && typedMethods(pin.path ?? "") ? Math.ceil((pin.name.length * NAME.char) / NAME.share + 2 * NAME.pad) + 1 : 0;
    return Math.max(header, named);
};

/** A last row for the lines cut short at the card's edge, `room` from its code's left, unless the card already ends in Read all. */
const withCutRow = (rows: Row[], room: number): Row[] => {
    const cut = rows.flatMap((r) => (r.kind === "line" && rowChars(r) * CARD.charWidth > room ? [r.line.at] : []));
    if (cut.length === 0 || opensReadAll(rows[rows.length - 1])) return rows;
    return [...rows, { kind: "fold", count: cut.length, from: cut[0], to: cut[0], tail: true, more: false, cut: true }];
};

/** Whether rows show every line of a file `lines` long at the head commit: nothing folded, cut short or left out. */
const showsWholeFile = (rows: readonly Row[], lines: number | undefined): boolean => {
    if (lines === undefined || !rows.every((r) => r.kind === "line")) return false;
    const shown = new Set(rows.flatMap((r) => (r.kind === "line" && r.line.n !== undefined ? [r.line.n] : [])));
    return shown.size === lines && [...shown].every((n) => n >= 1 && n <= lines);
};

/** `View full file` under the rows, unless they show the whole file already, or the PR deletes it. */
const withFullFileRow = (pin: Pin, rows: Row[], review: CardInput): Row[] => {
    const file = review.files.find((f) => f.path === pin.path);
    if (!pin.path || file?.status === "removed" || showsWholeFile(rows, file?.lines)) return rows;
    return [...rows, { kind: "full" }];
};

/**
 * A card as data: its rows, size, and where its strings start. A card at
 * its widest cuts long lines with `…`, Read all opening at the first. Its
 * last row opens its whole file, unless it shows every line already.
 */
export const pinCard = (pin: Pin, review: CardInput): CardModel => {
    const built = rowsOf(pin, review);
    const width = Math.round(clamp(Math.max(headerWidth(pin), ...built.map(rowWidth)), CARD.minWidth, CARD.maxWidth));
    const rows = withFullFileRow(pin, withCutRow(built, width - gutterOf(pin) - CARD.codePad), review);
    const anchors: Record<string, number> = {};
    for (const l of outgoing(review, pin.id)) {
        const i = rows.findIndex((r) => r.kind === "line" && r.line.t !== "del" && r.line.n === l.at);
        if (i >= 0) anchors[l.id] = i;
    }
    return { pin: pin.id, rows, width, height: CARD.header + rows.length * CARD.row + CARD.padBottom, anchors };
};
