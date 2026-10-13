/**
 * What a macro's use may write: a bound on the identifiers its expansion can
 * hold, every definition read of each macro taken at once. The names it may
 * write are the identifiers of its arguments and of the bodies of every
 * macro it reaches (the macros those bodies name, in turn); a token pasting
 * (`a ## _ ## b`) may also write any name made of its literal pieces with,
 * for each parameter, a token of the arguments or of those bodies
 * (`STUB(foo, get)` writes `foo_get`). Stringified parameters write none.
 */

import { SPLICE, type Macro } from "./preproc.ts";

/** A token pasting: its pieces in order, a literal or null for a parameter's token. */
type Template = (string | null)[];
/** What the macros a name reaches write: their bodies' names, pastings and numbers. */
export type Reach = { names: Set<string>; templates: Template[]; numbers: Set<string> };
/** What uses may write: names, the pastings of the macros they reach, and the tokens a pasting's parameter may take. */
export type Writes = { names: Set<string>; reaches: Set<Reach>; tokens: Set<string> };

/** Comments (dropped), strings and characters whole, identifiers, numbers, `##`, `#`, `->`, `...`, and single punctuation; a splice is space. */
const TOKEN = new RegExp(String.raw`${SPLICE}|\/\*[\s\S]*?\*\/|\/\/(?:${SPLICE}|[^\n])*|"(?:${SPLICE}|\\[\s\S]|[^"\\\n])*"?|'(?:${SPLICE}|\\[\s\S]|[^'\\\n])*'?|[A-Za-z_]\w*|\.?\d(?:[eEpP][+-]|[\w.])*|##|#|->|\.\.\.|\S`, "g");

export const IDENT = /^[A-Za-z_]\w*$/;

/** Words before a name and its `(` that make a call of it, not a declarator. */
const CALLERS = new Set(["return", "case", "sizeof", "else", "do", "goto", "typeof", "__typeof__", "_Alignof", "alignof", "defined"]);

/** Words whose parenthesized list is an attribute, an alignment or an asm label: a name after it is a declarator's. */
const ATTRIBUTES = new Set(["__attribute__", "__attribute", "__declspec", "_Alignas", "alignas", "__asm__", "__asm", "asm"]);

/** Whether the `)` at `close` ends an attribute's list: `__attribute__((unused))`, `__declspec(noinline)`. */
const closesAttribute = (toks: readonly string[], close: number): boolean => {
    let depth = 0;
    for (let k = close; k >= 0; k--) {
        if (toks[k] === ")") depth++;
        else if (toks[k] === "(" && --depth === 0) return ATTRIBUTES.has(toks[k - 1]) || (toks[k - 1] === "(" && ATTRIBUTES.has(toks[k - 2]));
    }
    return false;
};

/**
 * Whether a name in a token stream is called there, `f(…)` after an operator
 * or a bracket, and so declares nothing: a declarator's name follows a type,
 * `int f(void)`, a `*`, or an attribute (`__attribute__((unused)) f(void)`,
 * `[[maybe_unused]] f(void)`), and one that starts the stream follows
 * whatever comes before it.
 */
export const called = (toks: readonly string[], i: number): boolean =>
    i > 0 && toks[i + 1] === "(" && !(toks[i - 1] === "*" || (IDENT.test(toks[i - 1]) && !CALLERS.has(toks[i - 1])) || (toks[i - 1] === ")" && closesAttribute(toks, i - 1)) || (toks[i - 1] === "]" && toks[i - 2] === "]"));

/** A text's names outside attributes, alignments and asm labels (`__attribute__((…))`, `[[…]]`), and the names inside them. */
export const attributeSplit = (text: string): { outside: string[]; inside: string[] } => {
    const toks = tokens(text);
    const outside: string[] = [];
    const inside: string[] = [];
    for (let i = 0; i < toks.length; i++) {
        let end = -1;
        if (ATTRIBUTES.has(toks[i]) && toks[i + 1] === "(") end = argumentsAt(toks, i + 1)?.end ?? toks.length;
        else if (toks[i] === "[" && toks[i + 1] === "[") for (end = i + 2; end < toks.length && !(toks[end - 1] === "]" && toks[end - 2] === "]"); end++);
        if (end >= 0) {
            for (const t of toks.slice(i + 1, end)) if (IDENT.test(t)) inside.push(t);
            i = end - 1;
        } else if (IDENT.test(toks[i])) outside.push(toks[i]);
    }
    return { outside, inside };
};

/** Words that make a parenthesized list a declaration's parameters, not a call's arguments. */
const TYPE_WORDS = new Set(["void", "char", "short", "int", "long", "float", "double", "signed", "unsigned", "const", "volatile", "restrict", "struct", "union", "enum", "_Bool", "bool", "register", "_Complex", "_Atomic", "..."]);

/**
 * Whether tokens `from` to `to` hold a declarator, `helper(void)`,
 * `helper(size_t n, char *s)`: a name before a list whose every parameter
 * reads as a declaration's (a type's keyword first, `...`, two names in a
 * row, or a name and its `*`), not as an argument (`f(key, (int)n)`).
 */
const holdsDeclarator = (toks: readonly string[], from: number, to: number): boolean => {
    for (let i = from; i < to; i++) {
        if (!IDENT.test(toks[i]) || toks[i + 1] !== "(" || CALLERS.has(toks[i]) || ATTRIBUTES.has(toks[i])) continue;
        const params = argumentsAt(toks, i + 1)?.args ?? [];
        const declared = ([a, b]: [number, number]) => {
            const p = toks.slice(a, b);
            return TYPE_WORDS.has(p[0]) || (IDENT.test(p[0]) && !CALLERS.has(p[0]) && (IDENT.test(p[1] ?? "") || p[1] === "*"));
        };
        if (params.length > 0 && params.every(declared)) return true;
    }
    return false;
};

/** A text's tokens, as the preprocessor reads them, with where each starts. */
export const tokenize = (text: string, from = 0, to = text.length): { tok: string; at: number }[] => {
    const out: { tok: string; at: number }[] = [];
    TOKEN.lastIndex = from;
    for (let m = TOKEN.exec(text); m && m.index < to; m = TOKEN.exec(text)) if (!m[0].startsWith("/*") && !m[0].startsWith("//") && !/^\\\s/.test(m[0])) out.push({ tok: m[0], at: m.index });
    return out;
};

export const tokens = (text: string): string[] => tokenize(text).map((t) => t.tok);

/** Where a parenthesized argument list starting at `open` (a `(`) ends, and its arguments as token ranges; null when it doesn't close. */
export const argumentsAt = (toks: readonly string[], open: number): { args: [number, number][]; end: number } | null => {
    const args: [number, number][] = [];
    let depth = 0;
    let start = open + 1;
    for (let i = open; i < toks.length; i++) {
        const t = toks[i];
        if (t === "(" || t === "[" || t === "{") depth++;
        else if (t === ")" || t === "]" || t === "}") {
            depth--;
            if (depth === 0) {
                if (i > open + 1 || args.length > 0) args.push([start, i]);
                return { args, end: i + 1 };
            }
        } else if (t === "," && depth === 1) {
            args.push([start, i]);
            start = i + 1;
        }
    }
    return null;
};

/** Words before a parenthesized list that make no definition. */
const NOT_DEFINED = new Set(["if", "while", "for", "switch", "return", "sizeof", "case", "do", "else", "_Alignof", "alignof", "typeof", "__typeof__", "_Generic", "__attribute__", "__attribute", "__declspec", "__asm__", "__asm", "asm", "_Static_assert", "static_assert"]);

/**
 * The names tokens write as a definition may be: a name and its
 * parenthesized list (`f(…)`, `(f)(…)`; past closing parentheses and further
 * lists where a `*` comes before it, `(*f(int))(int)`) followed by a `{` or
 * a name (`BEGIN`, a K&R declaration). A macro's use read as a declarator,
 * `FN(helper)(void) {`, may define any name of its arguments.
 */
export const shapesIn = (toks: readonly string[], into: Set<string>) => {
    const opens = (j: number) => toks[j] === "{" || (IDENT.test(toks[j] ?? "") && !NOT_DEFINED.has(toks[j]));
    for (let i = 0; i < toks.length; i++) {
        if (!IDENT.test(toks[i]) || NOT_DEFINED.has(toks[i])) continue;
        let j: number;
        if (toks[i + 1] === "(") {
            j = argumentsAt(toks, i + 1)?.end ?? toks.length;
            if (toks[i - 1] === "*") while (toks[j] === ")" || toks[j] === "(") j = toks[j] === "(" ? (argumentsAt(toks, j)?.end ?? toks.length) : j + 1;
            else if (toks[j] === "(") {
                const k = argumentsAt(toks, j)?.end ?? toks.length;
                if (opens(k)) for (const t of toks.slice(i, j)) if (IDENT.test(t)) into.add(t);
                continue;
            }
        } else if (toks[i - 1] === "(" && toks[i + 1] === ")" && toks[i + 2] === "(") j = argumentsAt(toks, i + 2)?.end ?? toks.length;
        else continue;
        if (opens(j)) into.add(toks[i]);
    }
};

/** Words before a name that make it no declarator: it is returned, a case's, a tag's, or an operand. */
const NOT_DECLARED_AFTER = new Set([...CALLERS, "struct", "union", "enum"]);

/**
 * The parameters a macro's body writes as a declarator, by their place in
 * its list: one written after a type (`int sig`, `T name`) or an attribute,
 * or before a `{` (`DEF(sig) int sig { … }`); and one handed on to a
 * parameter another macro writes so (`#define WRAP(x) DEF(x)`). An argument
 * given there declares every name in it, whatever its list holds
 * (`DEF(helper())`, `DEF(helper(ctx_t))`).
 */
const declaring = new WeakMap<(name: string) => readonly Macro[] | undefined, WeakMap<Macro, Map<number, Set<number>>>>();
export const declaratorParams = (m: Macro, lookup: (name: string) => readonly Macro[] | undefined, depth = 0): Set<number> => {
    // Read once for each set of macros a lookup sees, at each depth; past four macros deep, every parameter may be one.
    const cache = declaring.get(lookup) ?? new WeakMap<Macro, Map<number, Set<number>>>();
    declaring.set(lookup, cache);
    const byDepth = cache.get(m) ?? new Map<number, Set<number>>();
    cache.set(m, byDepth);
    const hit = byDepth.get(depth);
    if (hit) return hit;
    const out = new Set<number>();
    if (!m.params) return out;
    if (depth > 4) return new Set(m.params.keys());
    const index = new Map(m.params.map((p, i) => [p, i]));
    const toks = tokens(m.body);
    for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        const k = index.get(t);
        if (k !== undefined) {
            const before = toks[i - 1] ?? "";
            if (toks[i + 1] === "{" || (IDENT.test(before) && !NOT_DECLARED_AFTER.has(before)) || (before === ")" && closesAttribute(toks, i - 1))) out.add(k);
        }
        if (toks[i + 1] !== "(" || !IDENT.test(t) || index.has(t)) continue;
        const call = argumentsAt(toks, i + 1);
        for (const inner of lookup(t) ?? []) {
            if (inner === m) continue;
            for (const j of declaratorParams(inner, lookup, depth + 1)) {
                const [a, b] = call?.args[j] ?? [0, 0];
                for (const x of toks.slice(a, b)) if (index.has(x)) out.add(index.get(x)!);
            }
        }
    }
    byDepth.set(depth, out);
    return out;
};

/** The names a macro's use declares through the parameters its definitions write as declarators. */
const declaredBy = (toks: readonly string[], at: number, lookup: (name: string) => readonly Macro[] | undefined, into: (name: string) => void) => {
    if (toks[at + 1] !== "(") return;
    const call = argumentsAt(toks, at + 1);
    if (!call) return;
    for (const m of lookup(toks[at]) ?? []) {
        if (!m.params) continue;
        for (const k of declaratorParams(m, lookup)) {
            // A variadic macro's last parameter takes every argument from its place on.
            const ranges = m.variadic && k === m.params.length - 1 ? call.args.slice(k) : call.args[k] ? [call.args[k]] : [];
            for (const [a, b] of ranges) for (const x of toks.slice(a, b)) if (IDENT.test(x)) into(x);
        }
    }
};

/** Every macro a definition list's bodies reach, by lookup: the names and pastings of their bodies, each macro read once. */
export type Reacher = ((name: string) => Reach) & { lookup: (name: string) => readonly Macro[] | undefined };

export const reacher = (lookup: (name: string) => readonly Macro[] | undefined): Reacher => {
    const cache = new Map<string, Reach>();
    const bodyOf = new Map<Macro, { names: string[]; templates: Template[]; numbers: string[] }>();
    const readBody = (m: Macro) => {
        let b = bodyOf.get(m);
        if (b) return b;
        const toks = tokens(m.body);
        const params = new Set(m.params ?? []);
        const names: string[] = [];
        const numbers: string[] = [];
        const templates: Template[] = [];
        for (let i = 0; i < toks.length; i++) {
            const t = toks[i];
            if (t === "#" && params.has(toks[i + 1])) {
                i++;
                continue;
            }
            if (IDENT.test(t) && !params.has(t) && !called(toks, i)) names.push(t);
            else if (IDENT.test(t) && !params.has(t) && lookup(t)) names.push(t);
            else if (/^\.?\d/.test(t)) numbers.push(t);
            // A pasting's chain, read once from its first piece.
            if (toks[i + 1] === "##" && toks[i - 1] !== "##") {
                const pieces: Template = [];
                let k = i;
                for (;;) {
                    pieces.push(params.has(toks[k]) || toks[k] === "__VA_ARGS__" ? null : toks[k]);
                    if (toks[k + 1] !== "##" || k + 2 >= toks.length) break;
                    k += 2;
                }
                templates.push(pieces);
            }
        }
        // A definition the body writes, its name after an attribute or a `)`: `static int __attribute__((unused)) f(void) { … }`; and one a macro it uses writes (`#define STUB DEF(helper(void))`).
        const shaped = new Set<string>();
        shapesIn(toks, shaped);
        for (let i = 0; i < toks.length; i++) if (IDENT.test(toks[i]) && !params.has(toks[i])) declaredBy(toks, i, lookup, (x) => shaped.add(x));
        for (const n of shaped) if (!params.has(n)) names.push(n);
        bodyOf.set(m, (b = { names, templates, numbers }));
        return b;
    };
    const reach = (start: string): Reach => {
        const hit = cache.get(start);
        if (hit) return hit;
        const out: Reach = { names: new Set(), templates: [], numbers: new Set() };
        const seen = new Set<string>([start]);
        const queue = [start];
        while (queue.length > 0) {
            const name = queue.pop()!;
            for (const m of lookup(name) ?? []) {
                const b = readBody(m);
                for (const n of b.names) {
                    out.names.add(n);
                    if (!seen.has(n) && lookup(n)) {
                        seen.add(n);
                        queue.push(n);
                    }
                }
                b.numbers.forEach((n) => out.numbers.add(n));
                out.templates.push(...b.templates);
            }
        }
        cache.set(start, out);
        return out;
    };
    return Object.assign(reach, { lookup });
};

export const NO_WRITES = (): Writes => ({ names: new Set(), reaches: new Set(), tokens: new Set() });

/**
 * What a use may write, added to `into`: `use` its tokens (a macro's name,
 * then its arguments if it takes some), `reach` the bodies its macros reach.
 * The macro's own name is written only where a body it reaches writes it
 * again: in a build that leaves it undefined it stands for itself, as the
 * tree reads. An argument holding a declarator (`DEF(helper(void))`), or
 * given where the macro's body writes a declarator, writes every name in it.
 */
export const writesOf = (use: readonly string[], reach: Reacher, into: Writes = NO_WRITES(), call = false): Writes => {
    const lookup = reach.lookup;
    // An alias called, `FREE(p)` for `#define FREE jv_mem_free`: the name it stands for is called, not declared.
    const alias = call && use.length === 1 ? (lookup(use[0]) ?? []).map((m) => m.body.trim()) : [];
    if (alias.length > 0 && alias.every((b) => IDENT.test(b))) {
        for (const b of alias) if (lookup(b)) writesOf([b], reach, into, true);
        return into;
    }
    if (use[1] === "(") {
        for (const [a, b] of argumentsAt(use, 1)?.args ?? []) {
            if (!holdsDeclarator(use, a, b)) continue;
            for (const t of use.slice(a, b)) if (IDENT.test(t)) into.names.add(t);
        }
        declaredBy(use, 0, lookup, (x) => {
            into.names.add(x);
            into.tokens.add(x);
        });
    }
    for (const [i, t] of use.entries()) {
        if (!IDENT.test(t)) {
            if (/^\.?\d/.test(t)) into.tokens.add(t);
            continue;
        }
        if (i > 0) {
            if (!called(use, i) || lookup(t)) into.names.add(t);
            into.tokens.add(t);
        }
        const r = reach(t);
        if (into.reaches.has(r)) continue;
        into.reaches.add(r);
        for (const n of r.names) {
            into.names.add(n);
            into.tokens.add(n);
        }
        r.numbers.forEach((n) => into.tokens.add(n));
    }
    return into;
};

/** Whether a name splits into a pasting's pieces: each literal as written, each parameter a token given (or none). */
const pastes = (t: Template, name: string, given: Set<string>): boolean => {
    const memo = new Set<string>();
    const fit = (k: number, at: number): boolean => {
        if (k === t.length) return at === name.length;
        const key = `${k}:${at}`;
        if (memo.has(key)) return false;
        memo.add(key);
        const piece = t[k];
        if (piece !== null) return name.startsWith(piece, at) && fit(k + 1, at + piece.length);
        for (let end = at; end <= name.length; end++) if ((end === at || given.has(name.slice(at, end))) && fit(k + 1, end)) return true;
        return false;
    };
    return fit(0, 0);
};

/** Whether uses may write a name. */
export const mayWrite = (w: Writes, name: string): boolean => {
    if (w.names.has(name)) return true;
    for (const r of w.reaches) for (const t of r.templates) if (pastes(t, name, w.tokens)) return true;
    return false;
};
