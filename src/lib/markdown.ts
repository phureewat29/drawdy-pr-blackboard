/**
 * A PR's description as GitHub shows it: GitHub-flavoured Markdown, lexed by
 * the vendored `marked` and rendered here, so every tag on the page is one
 * this module chose and all text is escaped. The description is untrusted:
 * raw HTML is dropped but for `<br>`, `<img>` (a chip, nothing is fetched)
 * and `<details>`, and links are inert.
 *
 * Two modes: `card` shows a `<details>` open, its summary a bold line,
 * since nothing on a card can be clicked open; `page` (the panel) keeps a
 * real `<details>`, which the reader opens.
 */

import { Lexer } from "../vendor/marked.ts";
import { sum, sumBy } from "./fp.ts";
import { escapeHtml, highlightLine, type HighlightState } from "./highlight.ts";
import { languageOfFence } from "./language.ts";

/** The token fields this module reads; `marked` gives more. */
export type MdToken = {
    type: string;
    raw?: string;
    text?: string;
    tokens?: MdToken[];
    depth?: number;
    lang?: string;
    ordered?: boolean;
    start?: number | "";
    items?: MdToken[];
    task?: boolean;
    checked?: boolean;
    href?: string;
    header?: { tokens: MdToken[]; align: string | null }[];
    rows?: { tokens: MdToken[]; align: string | null }[][];
    align?: (string | null)[];
};

export type MarkdownMode = "card" | "page";

/**
 * How much inline Markdown a description may lex. A run is a paragraph's,
 * a list item's, a cell's or a heading's text, and `marked`'s emphasis scan
 * grows with the square of a run's `*`, `_` and `~`: a 64 KB paragraph of
 * `*a _b` takes 12 s. Backticks and brackets cost nothing like it (64 KB of
 * them, 23 ms or less), so only those three count. A run with `few` of them
 * lexes fast at any length (200 `*` before 64 KB of words, 12 ms). A
 * denser run lexes only when `short` (2,000 characters of them take 12 ms),
 * and a description spends at most `dense` on such runs, in characters
 * squared: 8 of 2,000, about 100 ms. Any other run shows as typed.
 */
export const INLINE = { short: 2000, few: 200, dense: 8 * 2000 ** 2 } as const;
const delimiters = (src: string): number => src.match(/[*_~]/g)?.length ?? 0;
const typed = (src: string): MdToken => ({ type: "text", raw: src, text: src });

/** What is left of a description's `INLINE.dense`, spent as its dense runs are lexed. */
type Budget = { left: number };

/** Whether to lex `src`, spending from `budget` when it is dense. */
const lexable = (src: string, budget: Budget): boolean => {
    if (delimiters(src) <= INLINE.few) return true;
    if (src.length > INLINE.short || src.length ** 2 > budget.left) return false;
    budget.left -= src.length ** 2;
    return true;
};

/** The part of `marked`'s Lexer that `lexBlocks` drives: block lexing queues each block's inline run, with the array its tokens go in. */
type MarkedLexer = {
    tokens: MdToken[];
    inlineQueue: { src: string; tokens: MdToken[] }[];
    blockTokens: (src: string, tokens: MdToken[]) => MdToken[];
    inlineTokens: (src: string, tokens: MdToken[]) => MdToken[];
};

const ALERTS: Record<string, string> = { NOTE: "Note", TIP: "Tip", IMPORTANT: "Important", WARNING: "Warning", CAUTION: "Caution" };
const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/i;

/** Each alert's lead (its first paragraph after `[!NOTE]`) by that paragraph, found at lexing: rendering lexes nothing. */
const leads = new WeakMap<MdToken, MdToken[]>();

/**
 * `tokens` without their first `n` characters: an alert's marker, which
 * `marked` keeps as plain text, and a line break after it. Null when the
 * marker is anything else, such as a link.
 */
const dropMarker = (tokens: readonly MdToken[], n: number): MdToken[] | null => {
    const rest = [...tokens];
    let left = n;
    while (left > 0) {
        const t = rest[0];
        if (!t || (t.type !== "text" && t.type !== "br") || (t.type === "text" && t.text !== t.raw)) return null;
        const raw = t.raw ?? "";
        if (raw.length <= left) {
            left -= raw.length;
            rest.shift();
        } else if (t.type === "text") {
            rest[0] = { ...t, raw: raw.slice(left), text: raw.slice(left) };
            left = 0;
        } else return null;
    }
    return rest;
};

/** Finds every alert in `tokens`, at any depth, and keeps its lead: the paragraph's own tokens less the marker, else its rest lexed against `budget`. */
const findLeads = (tokens: readonly MdToken[], budget: Budget): void => {
    for (const t of tokens) {
        if (t.type === "blockquote") {
            const first = t.tokens?.[0];
            const alert = first?.type === "paragraph" ? ALERT.exec(first.text ?? "") : null;
            if (first && alert) {
                const rest = (first.text ?? "").slice(alert[0].length);
                leads.set(first, dropMarker(first.tokens ?? [], alert[0].length) ?? (lexable(rest, budget) ? (Lexer.lexInline(rest, { gfm: true }) as MdToken[]) : [typed(rest)]));
            }
            findLeads(t.tokens ?? [], budget);
        } else if (t.type === "list") for (const item of t.items ?? []) findLeads(item.tokens ?? [], budget);
    }
};

/** `marked`'s own `lex`: the blocks first, then each block's inline runs, but a run `lexable` refuses stays as typed. */
const lexBlocks = (body: string): MdToken[] => {
    const lexer = new Lexer({ gfm: true }) as unknown as MarkedLexer;
    lexer.blockTokens(body.replace(/\r\n|\r/g, "\n"), lexer.tokens);
    const budget = { left: INLINE.dense };
    for (let i = 0; i < lexer.inlineQueue.length; i++) {
        const { src, tokens } = lexer.inlineQueue[i];
        if (lexable(src, budget)) lexer.inlineTokens(src, tokens);
        else tokens.push(typed(src));
    }
    const tokens = lexer.tokens.filter((t) => t.type !== "space");
    findLeads(tokens, budget);
    return tokens;
};

/** The last few descriptions lexed, by their exact text: the layout, the board and the panel each ask for the same one. */
const lexed = new Map<string, MdToken[]>();
const KEPT = 4;

/**
 * The description's blocks, all of it: GitHub keeps one to 65,536 characters. `marked` recurses once per nested quote, so thousands
 * of `>` overflow the stack: such a description shows as plain text. Callers share the tokens and only read them.
 */
export const lexMarkdown = (body: string): MdToken[] => {
    const kept = lexed.get(body);
    if (kept) {
        lexed.delete(body);
        lexed.set(body, kept);
        return kept;
    }
    let tokens: MdToken[];
    try {
        tokens = lexBlocks(body);
    } catch {
        tokens = body.trim() ? [{ type: "paragraph", text: body, tokens: [{ type: "text", text: body }] }] : [];
    }
    lexed.set(body, tokens);
    if (lexed.size > KEPT) lexed.delete(lexed.keys().next().value!);
    return tokens;
};

/** Text into HTML the way `marked`'s own `escape(text, false)` does: an entity such as `&amp;` stays one. Code goes through `escapeHtml`, so `&amp;` in code reads `&amp;`. */
export const escapeText = (text: string): string =>
    text.replace(/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** GitHub's emoji shortcodes that PRs use most; any other `:name:` stays as written. */
const EMOJI: Record<string, string> = {
    tada: "🎉", sparkles: "✨", rocket: "🚀", bug: "🐛", fire: "🔥", zap: "⚡", memo: "📝", recycle: "♻️", art: "🎨", wrench: "🔧",
    hammer: "🔨", package: "📦", lock: "🔒", boom: "💥", warning: "⚠️", construction: "🚧", white_check_mark: "✅", heavy_check_mark: "✔️",
    x: "❌", lipstick: "💄", bookmark: "🔖", rotating_light: "🚨", arrow_up: "⬆️", arrow_down: "⬇️", pencil2: "✏️", eyes: "👀", wastebasket: "🗑️",
};

/** `:tada:` as GitHub shows it, 🎉, in titles and descriptions alike; never inside code. */
export const emojify = (text: string): string => text.replace(/:([a-z0-9_+-]+):/g, (whole, name: string) => EMOJI[name] ?? whole);

/** A title split on backticks: `Add \`data\` property` is text, code, text. */
export type Segment = { text: string; code: boolean };

export const segments = (title: string): Segment[] =>
    title
        .split("`")
        .map((text, i) => ({ text: i % 2 === 1 ? text : emojify(text), code: i % 2 === 1 }))
        .filter((s) => s.text.length > 0);

export const segmentsHtml = (parts: readonly Segment[]): string => parts.map((s) => (s.code ? `<code>${escapeHtml(s.text)}</code>` : escapeText(s.text))).join("");

const ATTACHMENT = /^https:\/\/github\.com\/user-attachments\/(assets|files)\//;
/** Elements whose content is never text to show. */
const RAW = new Set(["script", "style", "textarea", "title", "noscript", "iframe", "template", "svg", "math", "object"]);

type Ctx = {
    mode: MarkdownMode;
    /** In the panel, `<details>` left open, closed at the end. */
    open: number;
    /** On the card, a summary's bold line not closed yet: its `</summary>`, or its details' end, closes it. */
    summary: boolean;
    /** Inside a raw-text element (`<script>`, `<style>`), whose content is dropped. */
    drop: string | null;
};

/** A summary on the card: a bold line over what its `<details>` holds. */
const SUMMARY = ['<p class="md-details"><strong>', "</strong></p>"] as const;

const chip = (text: string) => `<span class="md-chip">${escapeText(text)}</span>`;

const attr = (attrs: string, name: string): string | null => {
    const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
    return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null;
};

/** `<details>`: kept in the panel; on the card, its end closes a summary left open. */
const detailsTag = (close: boolean, ctx: Ctx): string => {
    if (ctx.mode === "card") {
        if (!close || !ctx.summary) return "";
        ctx.summary = false;
        return SUMMARY[1];
    }
    if (!close) {
        ctx.open++;
        return "<details>";
    }
    if (ctx.open === 0) return "";
    ctx.open--;
    return "</details>";
};

/** `<summary>`: kept in the panel; on the card, a bold line, opened and closed in turn. */
const summaryTag = (close: boolean, ctx: Ctx): string => {
    if (ctx.mode === "page") return close ? "</summary>" : "<summary>";
    if (close !== ctx.summary) return "";
    ctx.summary = !close;
    return SUMMARY[close ? 1 : 0];
};

const PIECE = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][\w-]*)([^>]*)>|[^<]+|</g;

/** Raw HTML from the description: only the tags this module allows, the rest dropped with their text kept. */
const rawHtml = (text: string, ctx: Ctx): string => {
    let out = "";
    for (const [piece, close, rawName, attrs] of text.matchAll(PIECE)) {
        if (piece.startsWith("<!--")) continue;
        const name = rawName?.toLowerCase();
        if (ctx.drop) {
            if (name === ctx.drop && close) ctx.drop = null;
        } else if (name && !close && RAW.has(name) && !/\/\s*$/.test(attrs)) ctx.drop = name;
        else if (name === "details") out += detailsTag(Boolean(close), ctx);
        else if (name === "summary") out += summaryTag(Boolean(close), ctx);
        else if (name === "br") out += "<br>";
        else if (name === "img" && !close) {
            const alt = attr(attrs, "alt");
            out += chip(alt ? `Image: ${alt}` : "Image");
        } else if (!name) out += escapeText(piece);
    }
    return out;
};

const inlineToken = (t: MdToken, ctx: Ctx): string => {
    if (t.type === "html") return rawHtml(t.text ?? "", ctx);
    if (ctx.drop) return "";
    switch (t.type) {
        case "text":
            return t.tokens ? inline(t.tokens, ctx) : escapeText(emojify(t.text ?? ""));
        case "escape":
            return escapeText(t.text ?? "");
        case "strong":
        case "em":
        case "del":
            return `<${t.type}>${inline(t.tokens, ctx)}</${t.type}>`;
        case "codespan":
            return `<code>${escapeHtml(t.text ?? "")}</code>`;
        case "br":
            return "<br>";
        case "link":
            return `<span class="md-link" title="${escapeHtml(t.href ?? "")}">${inline(t.tokens, ctx)}</span>`;
        case "image":
            return chip(t.text ? `Image: ${t.text}` : "Image");
        case "checkbox":
            return "";
        default:
            return escapeText(t.text ?? "");
    }
};

const inline = (tokens: readonly MdToken[] | undefined, ctx: Ctx): string => (tokens ?? []).map((t) => inlineToken(t, ctx)).join("");

/** Whether a paragraph is a bare link to a file uploaded to GitHub. */
const isAttachment = (t: MdToken) => {
    const parts = (t.tokens ?? []).filter((x) => !(x.type === "text" && !(x.text ?? "").trim()));
    return parts.length === 1 && parts[0].type === "link" && ATTACHMENT.test(parts[0].href ?? "") && (parts[0].text ?? "") === parts[0].href;
};

const codeBlock = (t: MdToken): string => {
    const lang = languageOfFence(t.lang);
    const diff = (t.lang ?? "").trim().toLowerCase().split(/\s+/)[0] === "diff";
    const state: HighlightState = { inBlock: false };
    const lines = (t.text ?? "").split("\n").map((line) => {
        const kind = diff ? (line.startsWith("+") ? " add" : line.startsWith("-") ? " del" : "") : "";
        return `<div class="l${kind}">${(diff ? escapeHtml(line) : highlightLine(line.replace(/\t/g, "    "), lang, state)) || " "}</div>`;
    });
    return `<pre><code>${lines.join("")}</code></pre>`;
};

/** A quote, or a GitHub alert: `> [!NOTE]`, its label and its lead, the rest of its first paragraph. */
const blockquote = (t: MdToken, ctx: Ctx): string => {
    const [first, ...rest] = t.tokens ?? [];
    const alert = first?.type === "paragraph" ? ALERT.exec(first.text ?? "") : null;
    if (!alert) return `<blockquote>${blocks(t.tokens, ctx)}</blockquote>`;
    const kind = alert[1].toUpperCase();
    const remaining = (first.text ?? "").slice(alert[0].length);
    const lead = remaining.trim() ? `<p>${inline(leads.get(first) ?? [typed(remaining)], ctx)}</p>` : "";
    return `<blockquote class="md-alert ${kind.toLowerCase()}"><p><strong>${ALERTS[kind]}</strong></p>${lead}${blocks(rest, ctx)}</blockquote>`;
};

const list = (t: MdToken, ctx: Ctx): string => {
    const tag = t.ordered ? "ol" : "ul";
    const start = t.ordered && typeof t.start === "number" && t.start !== 1 ? ` start="${Math.max(0, Math.floor(t.start))}"` : "";
    const items = (t.items ?? []).map((item) => {
        const box = item.task ? `<span class="md-box${item.checked ? " on" : ""}"></span>` : "";
        return `<li${item.task ? ' class="md-task"' : ""}>${box}${blocks(item.tokens, ctx)}</li>`;
    });
    return `<${tag}${start}>${items.join("")}</${tag}>`;
};

const align = (a: string | null) => (a === "left" || a === "right" || a === "center" ? ` style="text-align:${a}"` : "");

const table = (t: MdToken, ctx: Ctx): string => {
    const head = (t.header ?? []).map((c) => `<th${align(c.align)}>${inline(c.tokens, ctx)}</th>`).join("");
    const rows = (t.rows ?? []).map((row) => `<tr>${row.map((c) => `<td${align(c.align)}>${inline(c.tokens, ctx)}</td>`).join("")}</tr>`).join("");
    return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
};

const block = (t: MdToken, ctx: Ctx): string => {
    if (t.type === "html") {
        const body = rawHtml(t.text ?? "", ctx);
        // Text left from raw HTML reads as a paragraph; a details line or a chip already is one.
        return /^\s*$/.test(body) || /^<(p|details|\/details|summary)/.test(body.trim()) ? body : `<p>${body.trim()}</p>`;
    }
    if (ctx.drop) return "";
    switch (t.type) {
        case "paragraph":
            return isAttachment(t) ? `<p>${chip("Attachment")}</p>` : `<p>${inline(t.tokens, ctx)}</p>`;
        case "text":
            return t.tokens ? inline(t.tokens, ctx) : escapeText(t.text ?? "");
        case "heading": {
            const level = Math.min(6, Math.max(1, t.depth ?? 1));
            return `<h${level}>${inline(t.tokens, ctx)}</h${level}>`;
        }
        case "code":
            return codeBlock(t);
        case "hr":
            return "<hr>";
        case "blockquote":
            return blockquote(t, ctx);
        case "list":
            return list(t, ctx);
        case "table":
            return table(t, ctx);
        case "space":
        case "def":
        case "checkbox":
            return "";
        default:
            return t.tokens ? `<p>${inline(t.tokens, ctx)}</p>` : "";
    }
};

const blocks = (tokens: readonly MdToken[] | undefined, ctx: Ctx): string => (tokens ?? []).map((t) => block(t, ctx)).join("");

/** The description as HTML for a `markdown-body` element (`MARKDOWN_CSS`). */
export const markdownHtml = (tokens: readonly MdToken[], mode: MarkdownMode): string => {
    const ctx: Ctx = { mode, open: 0, summary: false, drop: null };
    const out = blocks(tokens, ctx);
    return out + (ctx.summary ? SUMMARY[1] : "") + "</details>".repeat(ctx.open);
};

/** Characters a run of inline tokens shows, about, and its line breaks. */
const visible = (tokens: readonly MdToken[] | undefined): { chars: number; breaks: number } => {
    let chars = 0;
    let breaks = 0;
    for (const t of tokens ?? []) {
        if (t.type === "br" || (t.type === "html" && /^<br/i.test(t.text ?? ""))) breaks++;
        else if (t.type === "image" || (t.type === "html" && /^<img/i.test(t.text ?? ""))) chars += 8 + (t.text?.length ?? 0);
        else if (t.type === "html") continue;
        else if (t.type === "codespan") chars += (t.text?.length ?? 0) * 1.1 + 2;
        else if (t.tokens) {
            const inner = visible(t.tokens);
            chars += inner.chars;
            breaks += inner.breaks;
        } else chars += t.text?.length ?? 0;
    }
    return { chars, breaks };
};

/**
 * GitHub's metrics, as `MARKDOWN_CSS` sets them, in px: `line` of text,
 * `gap` below a block, `charWidth` a character about, `indent` of a list,
 * `codeLine` and `codePad` of a code block, `tableRow`, a quote's `quotePad`
 * below and `quoteIndent` in, `itemGap` between list items, a rule's `hr`
 * with its margins, `headingAbove` a heading or rule, and a heading's
 * wrapped lines at `headingLine` text lines each.
 */
const M = { line: 21, gap: 16, charWidth: 7.2, indent: 32, codeLine: 20, codePad: 32, tableRow: 34, quotePad: 16, quoteIndent: 16, itemGap: 3.5, hr: 52, headingAbove: 24, headingLine: 1.4 } as const;
/** A heading's height by level, its margins included. */
const HEADING = [0, 84, 74, 62, 58, 56, 54];

const textHeight = (tokens: readonly MdToken[] | undefined, width: number) => {
    const { chars, breaks } = visible(tokens);
    return (Math.max(1, Math.ceil((chars * M.charWidth) / Math.max(1, width))) + breaks) * M.line;
};

/** How far the estimate runs over Chrome's measure, at least: a little room for another screen's fonts. */
const MARGIN = 1.03;

/** A block's height at width `w`, with the gap below it; `nested` in a list item or a quote. */
const blockHeight = (t: MdToken, w: number, nested: boolean): number => {
    switch (t.type) {
        case "paragraph":
            return textHeight(t.tokens, w) + M.gap;
        case "text":
            return textHeight(t.tokens ?? [{ type: "text", text: t.text }], w);
        case "heading":
            return HEADING[Math.min(6, t.depth ?? 1)] + (textHeight(t.tokens, w) / M.line - 1) * M.line * M.headingLine;
        case "code":
            return (t.text ?? "").split("\n").length * M.codeLine + M.codePad + M.gap;
        case "hr":
            return M.hr;
        case "table":
            return ((t.rows?.length ?? 0) + 1) * M.tableRow + M.gap;
        case "blockquote":
            return nestedHeight(t.tokens ?? [], w - M.quoteIndent) + M.quotePad;
        case "list": {
            // Items .25em apart, and a nested list .25em below its item's text. In a loose list each item's paragraph
            // keeps 16 above instead, which the first one gives up to the block before the list.
            const items = (t.items ?? []).map((item) => Math.max(M.line, nestedHeight(item.tokens ?? [], w - M.indent)));
            const loose = (t.items ?? []).some((item) => item.tokens?.[0]?.type === "paragraph");
            const between = loose ? -M.gap : M.itemGap * (items.length - 1);
            return sum(items) + between + (nested ? M.itemGap : M.gap);
        }
        default:
            return 0;
    }
};

const nestedHeight = (tokens: readonly MdToken[], w: number) => sumBy(tokens, (t) => blockHeight(t, w, true));

/** Raw HTML as the card shows it: a summary is a line of its own, and what follows it in the same piece of HTML another. */
const htmlHeight = (t: MdToken, width: number) =>
    sumBy(
        (t.text ?? "").split(/<\/summary\s*>/i).map((part) => part.replace(/<!--[\s\S]*?(-->|$)|<[^>]*>/g, "")),
        (shown) => (/[^\s]/.test(shown) ? textHeight([{ type: "text", text: shown }], width) + M.gap : 0)
    );

/**
 * Each top-level block's height at `width`, with its gap below, estimated: the driver can't measure HTML, and a card's height is
 * fixed when it is made. A `<details>` counts as the card shows it, open: its summary a line, then what it holds.
 */
export const markdownBlocks = (tokens: readonly MdToken[], width: number): number[] => {
    let first = true;
    return tokens.map((t) => {
        if (t.type === "html") {
            const h = htmlHeight(t, width);
            if (h > 0) first = false;
            return h;
        }
        const h = blockHeight(t, width, false);
        // A heading's or rule's margin above collapses into the gap below the block before it; the first block has none above.
        const above = t.type === "heading" || t.type === "hr" ? (first ? M.headingAbove : M.gap) : 0;
        if (h > 0) first = false;
        return h - above;
    });
};

/** The description's height from its blocks' (`markdownBlocks`): the last block's gap below is not shown. */
export const blocksHeight = (blocks: readonly number[]): number => Math.ceil(Math.max(0, sum(blocks) - M.gap) * MARGIN);

/** How tall the description renders at `width`, estimated a little over what Chrome lays out. */
export const markdownHeight = (tokens: readonly MdToken[], width: number): number => blocksHeight(markdownBlocks(tokens, width));

/**
 * GitHub's `markdown-body` styles, on the cards' palette (`--md-*`, `--k`
 * and the diff colours from `PALETTES`). `.md` is the root.
 */
export const MARKDOWN_CSS = `
.md { font: 14px/21px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; color: var(--ink); overflow-wrap: break-word; }
.md > :first-child { margin-top: 0 !important; }
.md > :last-child { margin-bottom: 0 !important; }
.md p, .md blockquote, .md ul, .md ol, .md table, .md pre { margin: 0 0 16px; }
.md h1, .md h2, .md h3, .md h4, .md h5, .md h6 { margin: 24px 0 16px; font-weight: 600; line-height: 1.25; }
.md h1 { font-size: 2em; padding-bottom: .3em; border-bottom: 1px solid var(--md-border); }
.md h2 { font-size: 1.5em; padding-bottom: .3em; border-bottom: 1px solid var(--md-border); }
.md h3 { font-size: 1.25em; } .md h4 { font-size: 1em; } .md h5 { font-size: .875em; } .md h6 { font-size: .85em; color: var(--ink2); }
.md ul, .md ol { padding-left: 2em; }
.md ul ul, .md ul ol, .md ol ol, .md ol ul { margin: 0; }
.md li + li, .md li > ul, .md li > ol { margin-top: .25em; }
.md li > p { margin-top: 16px; margin-bottom: 0; }
.md li.md-task { list-style: none; }
.md li.md-task > .md-box { margin: 0 .3em .2em -1.4em; vertical-align: middle; }
.md-box { display: inline-block; width: 13px; height: 13px; border: 1px solid var(--md-border); border-radius: 3px; background: var(--bg2); opacity: .8; position: relative; }
.md-box.on { background: var(--md-link); border-color: var(--md-link); }
.md-box.on::after { content: ""; position: absolute; left: 3.5px; top: 0.5px; width: 3px; height: 7px; border: solid var(--bg); border-width: 0 2px 2px 0; transform: rotate(45deg); }
.md strong { font-weight: 600; }
.md-link { color: var(--md-link); }
.md code { padding: .2em .4em; margin: 0; font: 85%/1 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; background: rgb(129 139 152 / .12); border-radius: 6px; white-space: break-spaces; }
.md pre { padding: 16px; overflow: hidden; background: var(--md-code-bg); border-radius: 6px; font: 12.5px/20px ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; }
.md pre code { padding: 0; background: transparent; font: inherit; white-space: pre; display: block; }
.md pre .l { min-height: 20px; }
.md pre .l.add { background: var(--add-bg); color: var(--add); margin: 0 -16px; padding: 0 16px; }
.md pre .l.del { background: var(--del-bg); color: var(--del); margin: 0 -16px; padding: 0 16px; }
.md blockquote { padding: 0 1em; color: var(--ink2); border-left: .25em solid var(--md-border); }
.md blockquote > :last-child, .md li > :last-child { margin-bottom: 0; }
.md-alert.note { border-left-color: var(--md-link); } .md-alert.tip { border-left-color: var(--add); } .md-alert.important { border-left-color: var(--k); }
.md-alert.warning { border-left-color: var(--t); } .md-alert.caution { border-left-color: var(--del); }
.md-alert > p:first-child strong { color: var(--ink); }
.md hr { height: .25em; padding: 0; margin: 24px 0; background: var(--md-border); border: 0; }
.md table { border-spacing: 0; border-collapse: collapse; display: block; width: max-content; max-width: 100%; overflow: hidden; }
.md th, .md td { padding: 6px 13px; border: 1px solid var(--md-border); line-height: 21px; }
.md th { font-weight: 600; }
.md tr:nth-child(2n) td { background: var(--md-code-bg); }
.md-chip { display: inline-block; padding: 0 8px; border: 1px solid var(--md-border); border-radius: 6px; font-size: 12px; line-height: 20px; color: var(--ink2); background: var(--md-code-bg); }
.md-details { color: var(--ink); }
.md details { margin: 0 0 16px; } .md summary { cursor: pointer; }
.md .k { color: var(--k); } .md .s { color: var(--s); } .md .n { color: var(--n); } .md .c { color: var(--c); } .md .f { color: var(--f); } .md .t { color: var(--t); }
`;
