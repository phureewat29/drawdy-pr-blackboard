/**
 * Vue and Svelte components: where the code of a `.vue` or `.svelte` file
 * sits, found as Vue's SFC parser and Svelte's parser find it, so the
 * linker reads its `<script>` blocks at their own offsets. Templates and
 * markup are left out. A file whose blocks can't be read cleanly (an
 * unclosed or stray tag, a `<script>` inside a template, an attribute these
 * rules don't know) is no component here: it gets line-pattern cards.
 */

import type { Reading } from "../pack.ts";

export type Block = {
    /** Offsets of its code, between its tags. */
    start: number;
    end: number;
    /** Code that runs once per instance: Vue's `<script setup>`, Svelte's instance script. The other block can't see its names. */
    inner: boolean;
};

export type Component = {
    framework: "vue" | "svelte";
    /** The grammar its blocks are parsed with; TypeScript's when it has none, as the likeliest loaded. */
    grammar: "typescript" | "tsx" | "javascript";
    /** In file order. */
    blocks: Block[];
    /** Type parameters the inner block's tag declares: `generic="T extends Item"`. */
    generics: string[];
};

/** `odd`: a value Vue reads other than as written: with an entity, or unquoted with a quote, `<`, `=` or a backquote in it. */
type Tag = { name: string; attrs: Map<string, string | true>; end: number; selfClosing: boolean; odd: boolean };

const VOID = new Set("area,base,br,col,embed,hr,img,input,link,meta,param,source,track,wbr".split(","));
/** Vue's whitespace: space, tab, newline, form feed, carriage return. */
const isSpace = (c: string | undefined) => c === " " || c === "\n" || c === "\t" || c === "\f" || c === "\r";
const isLetter = (c: string | undefined) => c !== undefined && /[a-zA-Z]/.test(c);
const IDENT = /^[A-Za-z_$][\w$]*/;

/**
 * An opening tag at `i` (its `<`), read as Vue's tokenizer reads one; null
 * for what these rules don't take: `<` where an attribute would start, a
 * quote, `<` or `&` in a name, a name twice, the file ending inside it.
 */
const readTag = (text: string, i: number): Tag | null => {
    let j = i + 1;
    while (j < text.length && !isSpace(text[j]) && text[j] !== "/" && text[j] !== ">") j++;
    const name = text.slice(i + 1, j);
    const attrs = new Map<string, string | true>();
    let odd = false;
    for (;;) {
        while (isSpace(text[j])) j++;
        const c = text[j];
        if (c === undefined || c === "<") return null;
        if (c === ">") return { name, attrs, end: j + 1, selfClosing: false, odd };
        if (c === "/") {
            // `/`, whitespace, `>` closes the tag itself.
            do j++;
            while (isSpace(text[j]));
            if (text[j] === ">") return { name, attrs, end: j + 1, selfClosing: true, odd };
            continue;
        }
        const start = j;
        while (j < text.length && !isSpace(text[j]) && text[j] !== "/" && text[j] !== ">" && text[j] !== "=") j++;
        const attr = text.slice(start, j);
        if (attr === "" || /["'<&]/.test(attr) || attrs.has(attr)) return null;
        while (isSpace(text[j])) j++;
        let value: string | true = true;
        if (text[j] === "=") {
            j++;
            while (isSpace(text[j])) j++;
            const q = text[j];
            if (q === '"' || q === "'") {
                const close = text.indexOf(q, j + 1);
                if (close < 0) return null;
                value = text.slice(j + 1, close);
                j = close + 1;
            } else {
                const from = j;
                while (j < text.length && !isSpace(text[j]) && text[j] !== ">") j++;
                value = text.slice(from, j);
                odd ||= /["'<`=]/.test(value);
            }
            odd ||= value.includes("&");
        }
        attrs.set(attr, value);
    }
};

/**
 * Where raw text from `from` ends, as Vue's tokenizer ends a `<script>`'s:
 * at `</name`, in any case, then whitespace or `>`; and where its closing
 * tag ends. Null when none closes it.
 */
const closingTag = (text: string, from: number, name: string): { at: number; end: number } | null => {
    const close = `</${name}`;
    let k = 0;
    for (let j = from; j < text.length; j++) {
        const c = text.charCodeAt(j);
        if (k === close.length) {
            if (c === 62 || isSpace(text[j])) {
                const end = text.indexOf(">", j);
                return end < 0 ? null : { at: j - k, end: end + 1 };
            }
            k = 0;
        }
        if ((c | 32) === close.charCodeAt(k)) k++;
        else if (k === 0) {
            j = text.indexOf("<", j + 1);
            if (j < 0) return null;
            k = 1;
        } else k = c === 60 ? 1 : 0;
    }
    return null;
};

/** Whether a tag has `v-pre`, under which `{{ }}` is text. */
const preformatted = (tag: Tag) => [...tag.attrs.keys()].some((a) => a.startsWith("v-pre"));

/** A comment from `i` (its `<`), as Vue reads one (`<!-->` is empty): the offset after it, or -1. */
const vueComment = (text: string, i: number) => {
    const end = text.indexOf("-->", i + 2);
    return end < 0 ? -1 : end + 3;
};

/**
 * The offset where the root `<template>`'s content ends, read as HTML:
 * elements kept on a stack, a closing tag closing the nearest open one of
 * its name and those above it, `{{ }}` and comments skipped. Null on `v-pre`,
 * a `<script>` or `<style>` inside it, or a `<title>` or `<textarea>` holding
 * markup.
 */
const templateEnd = (text: string, from: number): { at: number; end: number } | null => {
    const stack = ["template"];
    let i = from;
    while (i < text.length) {
        const c = text[i];
        if (c === "{" && text[i + 1] === "{") {
            const close = text.indexOf("}}", i + 2);
            if (close < 0) return null;
            i = close + 2;
            continue;
        }
        if (c !== "<") {
            i++;
            continue;
        }
        const d = text[i + 1];
        if (text.startsWith("<!--", i)) {
            i = vueComment(text, i);
            if (i < 0) return null;
        } else if (d === "/") {
            if (!isLetter(text[i + 2])) return null;
            let j = i + 2;
            while (j < text.length && !isSpace(text[j]) && text[j] !== ">") j++;
            const name = text.slice(i + 2, j);
            const end = text.indexOf(">", j);
            if (end < 0) return null;
            const open = VOID.has(name) ? -1 : stack.lastIndexOf(name.toLowerCase());
            if (open === 0) return { at: i, end: end + 1 };
            if (open > 0) stack.length = open;
            i = end + 1;
        } else if (isLetter(d)) {
            const tag = readTag(text, i);
            if (!tag || preformatted(tag)) return null;
            const name = tag.name.toLowerCase();
            // Vue's raw-text tags start with these two letters as written: `<Title>` is a component.
            const raw = /^(sc|st|ti|te)/.test(tag.name) && /^(script|style|title|textarea)$/.test(name);
            if (raw && (name === "script" || name === "style")) return null;
            i = tag.end;
            if (tag.selfClosing || VOID.has(tag.name)) continue;
            if (!raw) {
                stack.push(name);
                continue;
            }
            // Text alone, perhaps with `{{ }}`, up to its closing tag.
            for (;;) {
                const lt = text.indexOf("<", i);
                const open = text.indexOf("{{", i);
                if (open >= 0 && (lt < 0 || open < lt)) {
                    const close = text.indexOf("}}", open + 2);
                    if (close < 0) return null;
                    i = close + 2;
                    continue;
                }
                const end = lt < 0 ? null : closingTag(text, lt, name);
                if (!end || end.at !== lt) return null;
                i = end.end;
                break;
            }
        } else if (d === "!" || d === "?") return null;
        else i++;
    }
    return null;
};

/** The blocks of a `.vue` file: its top-level `<script>` and `<script setup>`, as `@vue/compiler-sfc`'s `parse` gives them. */
const vueBlocks = (text: string): Component | null => {
    const scripts: { tag: Tag; start: number; end: number }[] = [];
    let template = false;
    let srcs = false;
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (c === "{" && text[i + 1] === "{") {
            const close = text.indexOf("}}", i + 2);
            if (close < 0) return null;
            i = close + 2;
            continue;
        }
        if (c !== "<") {
            i++;
            continue;
        }
        if (text.startsWith("<!--", i)) {
            i = vueComment(text, i);
            if (i < 0) return null;
            continue;
        }
        if (!isLetter(text[i + 1])) {
            if (/[!?/]/.test(text[i + 1] ?? "")) return null;
            i++;
            continue;
        }
        const tag = readTag(text, i);
        if (!tag || tag.odd || !/^[a-z][a-z0-9-]*$/.test(tag.name)) return null;
        if (tag.selfClosing) {
            if (tag.name === "script" || tag.name === "template") return null;
            i = tag.end;
            continue;
        }
        const lang = tag.attrs.get("lang");
        const html = tag.name === "template" && (lang === undefined || lang === true || lang === "" || lang === "html");
        if (html && (template || preformatted(tag))) return null;
        template ||= html;
        const close = html ? templateEnd(text, tag.end) : closingTag(text, tag.end, tag.name);
        if (!close) return null;
        srcs ||= tag.name === "script" && tag.attrs.has("src");
        if (tag.name === "script" && text.slice(tag.end, close.at).trim() !== "") scripts.push({ tag, start: tag.end, end: close.at });
        i = close.end;
    }
    if (srcs) return null;
    const langs = new Set<string | true | undefined>();
    let setups = 0;
    for (const { tag } of scripts) {
        const setup = tag.attrs.get("setup");
        if ([...tag.attrs.keys()].some((a) => a !== "lang" && a !== "setup" && !(a === "generic" && setup))) return null;
        if (setup !== undefined && setup !== true && setup !== "") return null;
        if (setup !== undefined) setups++;
        langs.add(tag.attrs.get("lang"));
    }
    if (setups > 1 || scripts.length - setups > 1 || langs.size > 1) return null;
    const lang = [...langs][0];
    const grammar = lang === "ts" ? "typescript" : lang === "tsx" ? "tsx" : lang === undefined || lang === "js" || lang === "jsx" ? "javascript" : null;
    if (!grammar) return null;
    const generic = scripts.find((s) => s.tag.attrs.has("setup"))?.tag.attrs.get("generic");
    const generics = generic === undefined ? [] : typeParameters(generic);
    if (!generics) return null;
    return { framework: "vue", grammar: scripts.length > 0 ? grammar : "typescript", blocks: scripts.map((s) => ({ start: s.start, end: s.end, inner: s.tag.attrs.has("setup") })), generics };
};

/** Svelte's whitespace: JavaScript's `\s`. */
const SVELTE_SPACE = /\s/;
/** A root `<script>` tag's attributes as Svelte reads them: static, `name` or `name=value`. */
const SVELTE_TAG = /^<script((?:\s+[^\s/>"'=]+(?:=(?:"[^"]*"|'[^']*'|[^>\s"']+))?)*)\s*>/;
const SVELTE_ATTR = /([^\s/>"'=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^>\s"']+)))?/g;
/** `<svelte:options>` with static attributes, which may come before the scripts. */
const SVELTE_OPTIONS = /^<svelte:options(?:\s+[a-zA-Z][\w-]*(?:=(?:"[^"<>{}]*"|'[^'<>{}]*'|\{(?:true|false)\}))?)*\s*\/>/;
/** The first `<script>` with a `lang`, comments skipped, decides whether Svelte reads every script as TypeScript. */
const SVELTE_LANG = /<!--[^]*?-->|<script\s+(?:[^>]*|(?:[^=>'"/]+=(?:"[^"]*"|'[^']*'|[^>\s]+)\s+)*)lang=(["'])?([^"' >]+)\1[^>]*>/g;

/**
 * The blocks of a `.svelte` file: the instance script and the module script
 * (`context="module"`, `module`), as `svelte/compiler`'s `parse` gives them.
 * Only scripts before any markup are taken, so none can sit inside an
 * element or a block; a `<script` anywhere after them makes the file unread.
 */
const svelteBlocks = (text: string): Component | null => {
    const scripts: { attrs: Map<string, string | true>; start: number; end: number }[] = [];
    let i = 0;
    for (;;) {
        while (i < text.length && SVELTE_SPACE.test(text[i])) i++;
        if (text.startsWith("<!--", i)) {
            const end = text.indexOf("-->", i + 4);
            if (end < 0) return null;
            i = end + 3;
            continue;
        }
        const head = text.slice(i, i + 2000);
        const options = SVELTE_OPTIONS.exec(head);
        if (options) {
            i += options[0].length;
            continue;
        }
        const tag = SVELTE_TAG.exec(head);
        if (!tag) break;
        const attrs = new Map<string, string | true>();
        for (const m of tag[1].matchAll(SVELTE_ATTR)) {
            if (attrs.has(m[1])) return null;
            attrs.set(m[1], m[2] ?? m[3] ?? m[4] ?? true);
        }
        const start = i + tag[0].length;
        const close = /<\/script\s*>/.exec(text.slice(start));
        if (!close) return null;
        scripts.push({ attrs, start, end: start + close.index });
        i = start + close.index + close[0].length;
    }
    if (/<script/i.test(text.slice(i)) || scripts.some((s) => /<script/i.test(text.slice(s.start, s.end)))) return null;
    const modules = scripts.filter((s) => s.attrs.has("module") || s.attrs.has("context"));
    if (modules.length > 1 || scripts.length - modules.length > 1) return null;
    for (const s of scripts) {
        for (const [name, value] of s.attrs) {
            const known = name === "lang" ? value === "ts" : name === "module" ? value === true : name === "context" ? value === "module" : name === "generics" && !modules.includes(s);
            if (!known) return null;
        }
    }
    let ts: RegExpExecArray | null;
    do ts = SVELTE_LANG.exec(text);
    while (ts && ts[0][1] !== "s");
    SVELTE_LANG.lastIndex = 0;
    const generic = scripts.find((s) => !modules.includes(s))?.attrs.get("generics");
    const generics = generic === undefined ? [] : typeParameters(generic);
    if (!generics) return null;
    return { framework: "svelte", grammar: ts?.[2] === "ts" || scripts.length === 0 ? "typescript" : "javascript", blocks: scripts.map((s) => ({ start: s.start, end: s.end, inner: !modules.includes(s) })), generics };
};

/** The names a `generic` attribute declares, `T extends A<B>, const U = C` giving T and U; null when one part names none. */
const typeParameters = (value: string | true): string[] | null => {
    if (value === true) return null;
    const parts: string[] = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < value.length; i++) {
        const c = value[i];
        if (c === "=" && value[i + 1] === ">") i++;
        else if ("<([{".includes(c)) depth++;
        else if (">)]}".includes(c) && --depth < 0) return null;
        else if (c === "," && depth === 0) {
            parts.push(value.slice(from, i));
            from = i + 1;
        }
    }
    if (depth !== 0) return null;
    parts.push(value.slice(from));
    const names = parts.map((p) => IDENT.exec(p.trim().replace(/^(?:(?:const|in|out)\s+)+/, ""))?.[0]);
    return names.every((n) => n !== undefined) ? (names as string[]) : null;
};

/** A `.vue` or `.svelte` file's component; undefined for any other file, null when its blocks can't be read cleanly. */
export const componentOf = (path: string, text: string): Component | null | undefined => {
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    if (ext !== "vue" && ext !== "svelte") return undefined;
    // Control characters other than whitespace: the parsers' character tests differ on them.
    if (/[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text)) return null;
    return ext === "vue" ? vueBlocks(text) : svelteBlocks(text);
};

/**
 * The text the parser reads for a component: its own length, with every
 * character outside its blocks blank but line breaks, and a `;` where a
 * block that another follows closes, so no statement runs on into the next.
 */
export const blocksText = (text: string, c: Component): string => {
    let out = "";
    let at = 0;
    for (const [i, b] of c.blocks.entries()) {
        out += text.slice(at, b.start).replace(/[^\r\n]/g, " ") + text.slice(b.start, b.end);
        at = b.end;
        if (i < c.blocks.length - 1 && text[at] === "<") {
            out += ";";
            at++;
        }
    }
    return out + text.slice(at).replace(/[^\r\n]/g, " ");
};

/** How a component is parsed: its blocks' grammar and its text with all but its blocks blank; undefined for any other file, null when its blocks can't be read cleanly. */
export const componentReading = (path: string, text: string): Reading | null | undefined => {
    const c = componentOf(path, text);
    return c && { grammar: c.grammar, text: blocksText(text, c) };
};
