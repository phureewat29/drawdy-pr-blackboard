/**
 * Syntax trees from tree-sitter grammars, flattened into typed arrays so the
 * linkers work on plain numbers instead of crossing into WebAssembly for
 * every node. Where a grammar's linker gives a units query (its `tags.scm`),
 * the tree also carries the declarations it defines.
 *
 * The caller supplies the wasm bytes: the driver downloads them and checks
 * each against its SHA-256 (`driver/grammars.ts`), the tests read them from
 * the pinned devDependencies. Nothing here does I/O.
 */

import { Language, Parser, Query, type Tree } from "../vendor/web-tree-sitter.ts";
import { memoize, pushTo } from "./fp.ts";
import { grammarOf } from "./language.ts";

// The vendored file is untyped JavaScript: its classes are values, so their instances get names here.
type Lang = InstanceType<typeof Language>;
type ParseTree = InstanceType<typeof Tree>;
type TagQuery = InstanceType<typeof Query>;

/** A syntax tree as arrays indexed by node id; node 0 is the root. */
export type Flat = {
    text: string;
    count: number;
    type: string[];
    /** Field name of a node in its parent (`name`, `body`, ...), or "". */
    field: string[];
    named: Uint8Array;
    start: Uint32Array;
    end: Uint32Array;
    parent: Int32Array;
    first: Int32Array;
    next: Int32Array;
    /** Offsets where each line starts, for 1-based line numbers. */
    lineStarts: number[];
    /** Characters inside ERROR nodes, plus one for each MISSING node. */
    errors: number;
    /** The `definition.*` captures of the grammar's `tags.scm`, on node ids, when it has one. */
    tags?: { capture: string; node: number }[];
};

/** What a grammar's linker asks of the parser (`langs/pack.ts`): the units query its trees carry, and the text it reads in place of a file's. */
export type GrammarUse = { units?: string; prepare?: (grammar: string, text: string) => string };

export type Syntax = {
    /** Loads a grammar from its wasm bytes, for its linker's `use`; a second load of one is a no-op. */
    add: (grammar: string, bytes: Uint8Array, use?: GrammarUse) => Promise<void>;
    /**
     * The file's tree, or null when its grammar isn't loaded or the file
     * can't be read (`readable`). `as`: the grammar to parse it with and the
     * text to parse in its place, the same length, where its extension
     * doesn't settle them (a Vue component's script blocks).
     */
    parse: (path: string, text: string, as?: { grammar: string; text: string }) => Flat | null;
};

/** A fact read once per parsed tree. */
export const perTree = <V>(read: (t: Flat) => V): ((t: Flat) => V) => memoize(read, { cache: new WeakMap() });

/**
 * The share of a file's text in ERROR and MISSING nodes above which the
 * parser's reading is not trusted and the line patterns take the file. The
 * scored pull requests and the examples peak at 0.6 % (elysia's `in out`
 * variance); React's Flow files, which broke the parser's links, measure
 * 3.2 % and 100 %.
 */
const MAX_ERROR_SHARE = 0.02;

const LEADING_COMMENTS = /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*/;

/** Whether a parsed file can be trusted: no `@flow` pragma in its leading comments, and few errors. */
const readable = (t: Flat): boolean => !/@flow\b/.test(LEADING_COMMENTS.exec(t.text)![0]) && t.errors <= t.text.length * MAX_ERROR_SHARE;

let runtime: Promise<void> | null = null;

const defines = (capture: string) => capture.startsWith("definition.");

/**
 * A grammar's `tags.scm` with only the patterns that define something left
 * on: no references are matched. Their other captures stay on, since a
 * predicate may read one (`(#any-of? @ignore "def" …)` fails on a
 * capture turned off); `parse` keeps the definitions' alone.
 */
const definitions = (lang: Lang, source: string): TagQuery => {
    const query = new Query(lang, source);
    const names: string[] = query.captureNames;
    (query.captureQuantifiers as number[][]).forEach((used, pattern) => {
        if (!used.some((q, capture) => q !== 0 && defines(names[capture]))) query.disablePattern(pattern);
    });
    return query;
};

/** Starts the tree-sitter runtime once per worker; a failed start is tried again on the next call. */
export const createSyntax = async (runtimeBytes: Uint8Array): Promise<Syntax> => {
    runtime ??= Parser.init({ wasmBinary: runtimeBytes, locateFile: (name: string) => name } as never).catch((err: unknown) => {
        runtime = null;
        throw err;
    });
    await runtime;
    const languages = new Map<string, Lang>();
    const queries = new Map<string, TagQuery>();
    const uses = new Map<string, GrammarUse>();
    const parser = new Parser();
    return {
        add: async (grammar, bytes, use = {}) => {
            if (languages.has(grammar)) return;
            const lang = await Language.load(bytes);
            languages.set(grammar, lang);
            uses.set(grammar, use);
            if (use.units) queries.set(grammar, definitions(lang, use.units));
        },
        parse: (path, text, as) => {
            const g = as ? as.grammar : grammarOf(path);
            const lang = g ? languages.get(g) : undefined;
            if (!g || !lang) return null;
            parser.setLanguage(lang);
            const prepare = uses.get(g)?.prepare;
            const source = as ? as.text : text;
            const tree = parser.parse(prepare ? prepare(g, source) : source, null, undefined);
            if (!tree) return null;
            try {
                const query = queries.get(g);
                const flat = flatten(tree, text, lang, query ? query.captures(tree.rootNode).filter((c: { name: string }) => defines(c.name)) : null);
                return readable(flat) ? flat : null;
            } finally {
                tree.delete();
            }
        },
    };
};

/**
 * One pre-order walk with a cursor: every node, named or not, with its field
 * and family links, and the query's captures moved onto the flat ids.
 */
const flatten = (tree: ParseTree, text: string, lang: Lang, captures: { name: string; node: { id: number; startIndex: number } }[] | null): Flat => {
    // The captured nodes by where they start, so only a node starting there is asked for its id.
    const wanted = new Map<number, { id: number; capture: string }[]>();
    for (const c of captures ?? []) pushTo(wanted, c.node.startIndex, { id: c.node.id, capture: c.name });
    const tags: { capture: string; node: number }[] = [];
    const fieldNames = lang.fields;
    const types = lang.types;
    // Whether a node is named depends on its type alone: asked once per type rather than once per node.
    const namedType: (boolean | undefined)[] = [];
    let cap = 1024;
    const type: string[] = [];
    const field: string[] = [];
    let named = new Uint8Array(cap);
    let start = new Uint32Array(cap);
    let end = new Uint32Array(cap);
    let parent = new Int32Array(cap);
    let first = new Int32Array(cap);
    let next = new Int32Array(cap);
    // Whether a node is an ERROR or sits inside one, so nested errors count once.
    let inError = new Uint8Array(cap);
    let errors = 0;
    const grow = () => {
        cap *= 2;
        named = resized(named, new Uint8Array(cap));
        inError = resized(inError, new Uint8Array(cap));
        start = resized(start, new Uint32Array(cap));
        end = resized(end, new Uint32Array(cap));
        parent = resized(parent, new Int32Array(cap));
        first = resized(first, new Int32Array(cap));
        next = resized(next, new Int32Array(cap));
    };
    const c = tree.walk();
    let count = 0;
    // The nodes whose children are being visited, and the last child added to each.
    const stack: number[] = [];
    const lastChild: number[] = [];
    const add = (): number => {
        if (count >= cap) grow();
        const id = count++;
        const typeId = c.nodeTypeId;
        type[id] = types[typeId] ?? c.nodeType;
        const f = c.currentFieldId;
        field[id] = f ? (fieldNames[f] ?? "") : "";
        named[id] = (namedType[typeId] ??= lang.nodeTypeIsNamed(typeId)) ? 1 : 0;
        const s = c.startIndex;
        const e = c.endIndex;
        start[id] = s;
        end[id] = e;
        first[id] = -1;
        next[id] = -1;
        const p = stack.length > 0 ? stack[stack.length - 1] : -1;
        parent[id] = p;
        const outer = p >= 0 && inError[p] === 1;
        inError[id] = outer || type[id] === "ERROR" ? 1 : 0;
        if (!outer && type[id] === "ERROR") errors += e - s;
        // A MISSING node takes no room.
        if (s === e && c.nodeIsMissing) errors++;
        const here = wanted.size > 0 ? wanted.get(s) : undefined;
        if (here) {
            const node = c.nodeId;
            for (const w of here) if (w.id === node) tags.push({ capture: w.capture, node: id });
        }
        if (p >= 0) {
            const last = lastChild[lastChild.length - 1];
            if (last < 0) first[p] = id;
            else next[last] = id;
            lastChild[lastChild.length - 1] = id;
        }
        return id;
    };
    add();
    let current = 0;
    for (;;) {
        if (c.gotoFirstChild()) {
            stack.push(current);
            lastChild.push(-1);
            current = add();
            continue;
        }
        for (;;) {
            if (c.gotoNextSibling()) {
                current = add();
                break;
            }
            if (!c.gotoParent()) {
                current = -1;
                break;
            }
            current = stack.pop()!;
            lastChild.pop();
        }
        if (current < 0) break;
    }
    c.delete();
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
    return { text, count, type, field, named, start, end, parent, first, next, lineStarts, errors, ...(captures ? { tags } : {}) };
};

/** `to`, holding `from`'s values first. */
const resized = <A extends Uint8Array | Uint32Array | Int32Array>(from: A, to: A): A => {
    to.set(from);
    return to;
};

export const children = (t: Flat, n: number): number[] => {
    const out: number[] = [];
    for (let c = t.first[n]; c >= 0; c = t.next[c]) out.push(c);
    return out;
};
export const namedChildren = (t: Flat, n: number): number[] => {
    const out: number[] = [];
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (t.named[c] && t.type[c] !== "comment") out.push(c);
    return out;
};
/** The first child in a field, or -1. */
export const child = (t: Flat, n: number, field: string): number => {
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (t.field[c] === field) return c;
    return -1;
};
export const childOfType = (t: Flat, n: number, ...types: string[]): number => {
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (types.includes(t.type[c])) return c;
    return -1;
};
export const hasToken = (t: Flat, n: number, token: string): boolean => {
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (!t.named[c] && t.type[c] === token) return true;
    return false;
};
/** The unnamed tokens among a node's children: keywords and operators. */
export const tokensOf = (t: Flat, n: number): string[] => {
    const out: string[] = [];
    for (let c = t.first[n]; c >= 0; c = t.next[c]) if (!t.named[c]) out.push(t.type[c]);
    return out;
};
export const textOf = (t: Flat, n: number): string => t.text.slice(t.start[n], t.end[n]);
/** 1-based line of an offset. */
export const lineOf = (t: Flat, offset: number): number => {
    let lo = 0;
    let hi = t.lineStarts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (t.lineStarts[mid] <= offset) lo = mid;
        else hi = mid - 1;
    }
    return lo + 1;
};
export const prevSibling = (t: Flat, n: number): number => {
    const p = t.parent[n];
    if (p < 0) return -1;
    let prev = -1;
    for (let c = t.first[p]; c >= 0 && c !== n; c = t.next[c]) prev = c;
    return prev;
};
