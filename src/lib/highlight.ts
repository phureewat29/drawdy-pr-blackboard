/**
 * Syntax colouring for diff cards: a small tokenizer, line by line, that
 * marks comments, strings, numbers, keywords, calls and type names. Vendored
 * because the marketplace allows no npm imports; precise enough to read a
 * diff by, not a parser.
 */

import type { Language } from "./language.ts";

/** Carried from line to line: whether a block comment is still open. */
export type HighlightState = { inBlock: boolean };

const words = (s: string) => new Set(s.split(" "));

const C_LIKE = "if else for while do switch case break continue default return new delete throw try catch finally class extends this super static public private protected const let var void null true false import export from as typeof instanceof in of async await yield function interface enum type implements package";
const KEYWORDS: Partial<Record<Language, Set<string>>> = {
    ts: words(`${C_LIKE} readonly declare namespace module keyof infer never unknown any satisfies abstract override get set undefined`),
    js: words(`${C_LIKE} undefined get set`),
    py: words("def class return if elif else for while in not and or is None True False import from as with try except finally raise yield lambda pass break continue global nonlocal async await assert del self"),
    go: words("func package import return if else for range switch case default break continue go defer select chan map struct interface type var const nil true false fallthrough goto"),
    rs: words("fn let mut pub crate mod use impl trait struct enum match if else for while loop return break continue self Self super where as in ref move async await dyn const static unsafe true false Some None Ok Err"),
    java: words(`${C_LIKE} final abstract synchronized throws boolean int long double float char byte short`),
    kt: words("fun val var class object interface if else when for while do return break continue try catch finally throw import package as is in out null true false this super override open data sealed suspend companion private public internal protected"),
    swift: words("func let var class struct enum protocol extension if else guard for while repeat return break continue switch case default import self Self nil true false init deinit throws throw try catch async await public private internal fileprivate static"),
    rb: words("def class module end if elsif else unless while until for in do return yield begin rescue ensure raise nil true false self super require require_relative attr_reader attr_accessor"),
    php: words(`${C_LIKE} function echo namespace use fn match array`),
    cs: words(`${C_LIKE} using namespace readonly override virtual sealed partial string int bool var get set async await`),
    c: words("if else for while do switch case break continue default return struct union enum typedef static const void int char long short unsigned signed float double sizeof include define NULL true false class public private protected template typename namespace using virtual auto"),
    sh: words("if then else elif fi for while do done case esac function return local export in"),
    sql: words("select from where and or not insert into values update set delete create table alter drop index join left right inner outer on group by order having limit as null is distinct union"),
};

const LINE_COMMENT: Partial<Record<Language, string>> = {
    ts: "//",
    js: "//",
    go: "//",
    rs: "//",
    java: "//",
    kt: "//",
    swift: "//",
    php: "//",
    cs: "//",
    c: "//",
    py: "#",
    rb: "#",
    sh: "#",
    yaml: "#",
    toml: "#",
    sql: "--",
};

const BLOCK_COMMENTS = new Set<Language>(["ts", "js", "go", "rs", "java", "kt", "swift", "php", "cs", "c", "css"]);

export const escapeHtml = (s: string): string =>
    s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const span = (cls: string, text: string) => `<span class="${cls}">${escapeHtml(text)}</span>`;

/**
 * One line as HTML with `<span class>` marks: c comment, s string, n number,
 * k keyword, f call, t type. Updates `state` for the next line.
 */
export const highlightLine = (text: string, lang: Language, state: HighlightState): string => {
    const keywords = KEYWORDS[lang];
    const lineComment = LINE_COMMENT[lang];
    const blocks = BLOCK_COMMENTS.has(lang);
    if (lang === "md" || lang === "text") return escapeHtml(text);
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
        if (ch === '"' || ch === "'" || ch === "`") {
            let j = i + 1;
            while (j < text.length && text[j] !== ch) j += text[j] === "\\" ? 2 : 1;
            out += span("s", text.slice(i, j + 1));
            i = j + 1;
            continue;
        }
        const num = /^\d[\d_]*(\.\d+)?([eE][+-]?\d+)?[a-zA-Z]*/.exec(rest);
        if (num && !/[\w$]/.test(text[i - 1] ?? "")) {
            out += span("n", num[0]);
            i += num[0].length;
            continue;
        }
        const ident = /^[#@]?[A-Za-z_$][\w$]*/.exec(rest);
        if (ident) {
            const word = ident[0];
            const after = text.slice(i + word.length).trimStart();
            if (keywords?.has(word)) out += span("k", word);
            else if (after.startsWith("(") || (after.startsWith("<") && /^<[\w\s,.]*>\s*\(/.test(after))) out += span("f", word);
            else if (/^[A-Z][a-z0-9]/.test(word) && lang !== "sql") out += span("t", word);
            else out += escapeHtml(word);
            i += word.length;
            continue;
        }
        out += escapeHtml(ch);
        i += 1;
    }
    return out;
};
