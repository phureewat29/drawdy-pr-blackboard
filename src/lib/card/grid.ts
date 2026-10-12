/**
 * A card is a component: an iframe that can't report where it was clicked.
 * So every card is built on a fixed grid, a 56 px header then rows of
 * exactly 20 px, kept as data: the layout reads it to start strings at the
 * right row, and the navigator turns a canvas click back into a row.
 */

import type { DiffLine } from "../diff.ts";
import { typedMethods } from "../language.ts";
import type { Pin } from "../model.ts";
import type { TestCase } from "../symbols.ts";

/**
 * The grid, in px, and what a card holds. Documented here rather than on
 * each field, as `LAYOUT` is: the object ships twice.
 *
 * - `charWidth`: one character of the code font at 12.5 px.
 * - `gutter`: two line-number columns, the +/− column and the call arrow;
 *   `plainGutter` on an unchanged caller's card, one line-number column and
 *   the arrow. `codePad`: kept clear right of the code.
 * - `maxRows`: code rows a card shows at most; rows that start a string are
 *   never cut. `contextRows`: the same on an unchanged caller's card.
 * - `context`: unchanged lines a card keeps on each side of a change.
 * - `maxCases`: test cases a test card lists at most.
 */
export const CARD = {
    header: 56,
    row: 20,
    padBottom: 12,
    minWidth: 480,
    maxWidth: 880,
    charWidth: 7.6,
    gutter: 124,
    plainGutter: 68,
    codePad: 12,
    maxRows: 24,
    context: 2,
    contextRows: 10,
    maxCases: 12,
} as const;

export type Row =
    | { kind: "line"; line: DiffLine; html: string; call?: boolean }
    /**
     * `⋯ 23 lines`; the last one reads `· Read all`. `cut`: no line is folded,
     * but `count` lines are cut short at the card's edge, the first at `from`.
     */
    | { kind: "fold"; count: number; from: number; to: number; tail: boolean; more: boolean; cut?: true }
    /** Unchanged lines between two hunks: the diff doesn't hold them, so nothing opens there. */
    | { kind: "gap"; count: number }
    /** `depth`: how many of the shown groups above the case hold it. */
    | { kind: "case"; test: TestCase; depth: number }
    | { kind: "info"; text: string; readAll?: boolean };

export type CardModel = {
    pin: string;
    rows: Row[];
    width: number;
    height: number;
    /** The row each outgoing link's string starts at, by link id. */
    anchors: Record<string, number>;
};

/** Whether a row opens Read all: `· Read all` in its text. */
export const opensReadAll = (r: Row | undefined): boolean => (r?.kind === "fold" && r.tail) || (r?.kind === "info" && r.readAll === true);

export const expandTabs = (text: string): string => text.replace(/\t/g, "    ");

/** The middle of a row, in pixels from the card's top; -1 is the header. */
export const rowMiddle = (row: number): number => (row < 0 ? CARD.header / 2 : CARD.header + row * CARD.row + CARD.row / 2);

/** A fold row: its card-local top and the head line Read all opens at, 0 for the first change. */
export type Fold = [y: number, line: number];

/** The rows that open Read all: `⋯ 23 lines`, `· Read all`, and a test card's last row. */
export const foldsOf = (card: CardModel): Fold[] =>
    card.rows.flatMap((r, i): Fold[] => {
        const y = CARD.header + i * CARD.row;
        if (r.kind === "fold") return [[y, r.from]];
        return r.kind === "info" && r.readAll ? [[y, 0]] : [];
    });

/** The fold row under card-local `y`, if any. */
export const foldAt = (folds: readonly Fold[], y: number): Fold | null => folds.find(([top]) => y >= top && y < top + CARD.row) ?? null;

/** A card's name in its header: `pad` px in from either side, in 15 px monospace, about `char` px a character, cut at `share` of the card. */
export const NAME = { pad: 14, share: 0.52, char: 9.2 } as const;

/** Where a card's name sits in its header, for a card at `card` drawn `scale` times its planned size; about 9 px a character, a little short. */
export const nameRect = (card: { x: number; y: number; width: number }, name: string, scale = 1): { x: number; y: number; width: number; height: number } => {
    const width = Math.min(name.length * 9, (card.width / scale) * NAME.share) + 4;
    return { x: card.x + NAME.pad * scale, y: card.y, width: width * scale, height: CARD.header * scale };
};

/** Whether a pin is a declaration's card, changed or not. */
export const isDeclaration = (pin: Pick<Pin, "kind">): boolean => pin.kind === "change" || pin.kind === "context";

/** Where a card's code column starts. */
export const gutterOf = (pin: Pick<Pin, "kind">): number => (pin.kind === "context" ? CARD.plainGutter : CARD.gutter);

/**
 * A card's name as its header shows it, `width` wide. A typed method that doesn't fit loses its type from the left, never the method,
 * `…ConfigFlow.async_step_user()`, and shows alone with fewer than 8 characters of its type left. Read all shows the whole name.
 */
export const headerName = (pin: Pick<Pin, "kind" | "name" | "path">, width: number): string => {
    const room = Math.floor(((width - 2 * NAME.pad) * NAME.share) / NAME.char);
    const parts = /^(\S+)(\.|::)([^\s.:()]+(?:\(\))?)$/.exec(pin.name);
    if (pin.name.length <= room || !parts || !isDeclaration(pin) || !typedMethods(pin.path ?? "")) return pin.name;
    const [, type, separator, method] = parts;
    const keep = room - 1 - separator.length - method.length;
    return keep >= 8 ? `…${type.slice(type.length - keep)}${separator}${method}` : method;
};
