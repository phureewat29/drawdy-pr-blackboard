/**
 * Syntax colouring for diff cards: a small tokenizer, line by line, that
 * marks comments, strings, numbers, keywords, calls and type names. Vendored
 * because the marketplace allows no npm imports; precise enough to read a
 * diff by, not a parser.
 */

import { PACKS } from "./langs/index.ts";
import type { Highlight } from "./langs/pack.ts";
import { packById, type Language } from "./language.ts";

/** Carried from line to line: whether a block comment is still open. */
export type HighlightState = { inBlock: boolean };

const words = (s: string) => new Set(s.split(" "));

/** Each pack's keywords, by its id. */
const KEYWORDS = new Map(PACKS.flatMap((p) => (p.highlight && p.highlight.keywords ? [[p.id, words(p.highlight.keywords)] as const] : [])));

export const escapeHtml = (s: string): string =>
    s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const span = (cls: string, text: string) => `<span class="${cls}">${escapeHtml(text)}</span>`;

/** Where a string starting at `i` ends, past its closing quote; a backslash escapes the character after it. */
const stringEnd = (text: string, i: number): number => {
    let j = i + 1;
    while (j < text.length && text[j] !== text[i]) j += text[j] === "\\" ? 2 : 1;
    return j + 1;
};

/** A word as a keyword, a call, a type name (capitalised, unless the language says not) or plain text; `after` is what follows it. */
const wordHtml = (word: string, after: string, keywords: ReadonlySet<string> | undefined, look: Highlight | undefined): string => {
    if (keywords?.has(word)) return span("k", word);
    if (after.startsWith("(") || (after.startsWith("<") && /^<[\w\s,.]*>\s*\(/.test(after))) return span("f", word);
    if (/^[A-Z][a-z0-9]/.test(word) && look?.types !== false) return span("t", word);
    return escapeHtml(word);
};

/**
 * One line as HTML with `<span class>` marks: c comment, s string, n number,
 * k keyword, f call, t type. Updates `state` for the next line.
 */
export const highlightLine = (text: string, lang: Language, state: HighlightState): string => {
    const look = packById(lang)?.highlight;
    if (lang === "text" || look === false) return escapeHtml(text);
    const lineComment = look?.comment;
    const blocks = look?.blocks === true;
    const keywords = KEYWORDS.get(lang);
    let out = "";
    let i = 0;
    while (i < text.length) {
        if (state.inBlock) {
            const end = text.indexOf("*/", i);
            const stop = end < 0 ? text.length : end + 2;
            out += span("c", text.slice(i, stop));
            i = stop;
            if (end >= 0) state.inBlock = false;
            continue;
        }
        const rest = text.slice(i);
        if (blocks && rest.startsWith("/*")) {
            state.inBlock = true;
            out += span("c", "/*");
            i += 2;
            continue;
        }
        if (lineComment && rest.startsWith(lineComment)) {
            out += span("c", rest);
            break;
        }
        // A JSDoc or block comment's middle lines, seen without their opening.
        if (blocks && i === 0 && /^\s*\*(\s|\/|$)/.test(text)) {
            out += span("c", text);
            break;
        }
        const ch = text[i];
        if ((look?.strings ?? "\"'`").includes(ch)) {
            const end = stringEnd(text, i);
            out += span("s", text.slice(i, end));
            i = end;
            continue;
        }
        const num = /^\d[\d_]*(\.\d+)?([eE][+-]?\d+)?[a-zA-Z]*/.exec(rest);
        if (num && !/[\w$]/.test(text[i - 1] ?? "")) {
            out += span("n", num[0]);
            i += num[0].length;
            continue;
        }
        const word = /^[#@]?[A-Za-z_$][\w$]*/.exec(rest)?.[0];
        if (word) {
            out += wordHtml(word, text.slice(i + word.length).trimStart(), keywords, look);
            i += word.length;
            continue;
        }
        out += escapeHtml(ch);
        i += 1;
    }
    return out;
};
