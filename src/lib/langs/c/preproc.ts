/**
 * What C's preprocessor reads in a file's text, read from the text alone, as
 * the grammar can't be trusted with it (it reads `#ifdef __cplusplus` /
 * `extern "C" {` / `#endif` as a block holding the rest of the header): the
 * directives (`%:` and `??=` spelled too, comments before them, lines
 * spliced as GCC and clang splice them), outside comments and strings; the
 * conditional branches each offset sits in, and which can never be
 * compiled; the includes; the macros defined or undefined; the include
 * guard.
 */

/** A line splice: a backslash, then spaces (which GCC and clang allow), then the line's end. */
export const SPLICE = String.raw`\\[ \t\v\f]*\r?\n`;
const SPLICES = new RegExp(SPLICE, "g");

/**
 * A directive and the lines it continues, a comment, a string or a
 * character: each a token, so nothing inside one reads as a directive. A
 * directive's `#` may follow comments at the start of its line, the first
 * of them begun on a line before, where nothing but space precedes it.
 */
const TOKENS = new RegExp(String.raw`^[ \t]*(?:\/\*(?:[^*]|\*(?!\/))*\*\/[ \t]*)*(?:#|%:|\?\?=)(?:[ \t]|${SPLICE})*((?:\w|${SPLICE})*)((?:${SPLICE}|[^\n])*)|\/\/(?:${SPLICE}|[^\n])*|\/\*[\s\S]*?(?:\*\/|$)|"(?:${SPLICE}|\\[\s\S]|[^"\\\n])*"?|'(?:${SPLICE}|\\[\s\S]|[^'\\\n])*'?`, "gm");

export type Directive = { name: string; rest: string; start: number; end: number };

/** A conditional's branch: its opening directive's offset, which branch of it (0 the `#if`, then each `#elif` and the `#else`), and the conditions read up to it. */
export type Branch = { at: number; index: number; dead: boolean; conds: string };

/** An include: the path it names; a computed one (`#include RAX_MALLOC_INCLUDE`) names none and gives its macro. */
export type Include = { spec: string; angle: boolean; start: number; line: number; macro?: string };

/** A macro's definition; `file` the file or build file that wrote it. */
export type Macro = { name: string; params: string[] | null; variadic: boolean; body: string; start: number; file?: string };

export type Preproc = {
    directives: Directive[];
    /** The branches open at an offset, outermost first, a header's include guard left out. */
    branchesAt: (offset: number) => Branch[];
    includes: Include[];
    /** Every `#define`, in order. */
    macros: Macro[];
    /** Every name a `#define` or `#undef` names, or a pragma makes weak or renames. */
    macroNames: Set<string>;
    /** Where a pragma restores a macro (`pop_macro`), as a directive or the `_Pragma` operator. */
    pops: number[];
    /** The include guard's name, when one wraps the whole file. */
    guard: string | null;
    /** Whether a conditional opens or closes where it can't (more `#endif`s than `#if`s, or one left open). */
    unbalanced: boolean;
};

const lineAt = (starts: number[], offset: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= offset) lo = mid;
        else hi = mid - 1;
    }
    return lo + 1;
};

/** A directive's text with its lines spliced and its comments blanked. */
const clean = (rest: string): string => rest.replace(SPLICES, "").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/, "").trim();

/** A conditional directive's condition, written one way: `#ifdef X` as `defined(X)`, spaces dropped. */
const condition = (d: Directive): string => {
    const rest = d.rest.replace(/\s+/g, "").replace(/defined([A-Za-z_]\w*)/g, "defined($1)");
    if (d.name === "ifdef" || d.name === "elifdef") return `defined(${rest})`;
    if (d.name === "ifndef" || d.name === "elifndef") return `!defined(${rest})`;
    return d.name === "else" ? "else" : rest;
};

const MAX = 2n ** 63n - 1n;
const MIN = -(2n ** 63n);

/**
 * A `#if` condition's value where its names don't decide it (`0`, `(0)`,
 * `0L`, `0 && defined(X)`, `1 || X`): a number, else null. Each name, and
 * anything outside signed 64-bit arithmetic (an unsigned literal, an
 * overflow), is unknown.
 */
export const constantOf = (cond: string): bigint | null => {
    const toks = cond.match(/0[xX][0-9a-fA-F]+\w*|0[bB][01]+\w*|\d+\w*|'(?:\\.|[^'\\])*'|[A-Za-z_]\w*|&&|\|\||<<|>>|<=|>=|==|!=|\S/g) ?? [];
    let i = 0;
    const fail = (): never => {
        throw new Error("not constant");
    };
    const fit = (v: bigint | null): bigint | null => (v === null ? null : v > MAX || v < MIN ? fail() : v);
    const peek = () => toks[i];
    const take = (t: string) => (toks[i] === t ? (i++, true) : false);
    const skipParens = () => {
        if (!take("(")) return;
        for (let depth = 1; depth > 0; i++) {
            if (i >= toks.length) fail();
            if (toks[i] === "(") depth++;
            else if (toks[i] === ")") depth--;
        }
    };
    const primary = (): bigint | null => {
        const t = toks[i++];
        if (t === undefined) return fail();
        if (t === "(") {
            const v = ternary();
            if (!take(")")) fail();
            return v;
        }
        if (/^[A-Za-z_]/.test(t)) {
            if (t === "defined") {
                if (take("(")) {
                    i++;
                    if (!take(")")) fail();
                } else i++;
                return null;
            }
            if (peek() === "(") skipParens();
            return null;
        }
        const m = /^(?:0[xX]([0-9a-fA-F]+)|0[bB]([01]+)|(\d+))([lLzZ]*)$/.exec(t);
        if (!m) return fail();
        const v = m[1] !== undefined ? BigInt(`0x${m[1]}`) : m[2] !== undefined ? BigInt(`0b${m[2]}`) : /^0\d/.test(m[3]) ? BigInt(`0o${m[3].slice(1)}`) : BigInt(m[3]);
        return fit(v);
    };
    const unary = (): bigint | null => {
        if (take("!")) {
            const v = unary();
            return v === null ? null : v === 0n ? 1n : 0n;
        }
        if (take("~")) {
            const v = unary();
            return v === null ? null : ~v;
        }
        if (take("-")) {
            const v = unary();
            return v === null ? null : fit(-v);
        }
        if (take("+")) return unary();
        return primary();
    };
    type Op = (a: bigint, b: bigint) => bigint | null;
    const B = (c: boolean) => (c ? 1n : 0n);
    const levels: Map<string, Op>[] = [
        new Map<string, Op>([["*", (a, b) => a * b], ["/", (a, b) => (b === 0n ? null : a / b)], ["%", (a, b) => (b === 0n ? null : a % b)]]),
        new Map<string, Op>([["+", (a, b) => a + b], ["-", (a, b) => a - b]]),
        new Map<string, Op>([["<<", (a, b) => (b < 0n || b > 62n || a < 0n ? null : a << b)], [">>", (a, b) => (b < 0n || b > 62n || a < 0n ? null : a >> b)]]),
        new Map<string, Op>([["<", (a, b) => B(a < b)], [">", (a, b) => B(a > b)], ["<=", (a, b) => B(a <= b)], [">=", (a, b) => B(a >= b)]]),
        new Map<string, Op>([["==", (a, b) => B(a === b)], ["!=", (a, b) => B(a !== b)]]),
        new Map<string, Op>([["&", (a, b) => a & b]]),
        new Map<string, Op>([["^", (a, b) => a ^ b]]),
        new Map<string, Op>([["|", (a, b) => a | b]]),
    ];
    const opAt = (level: number): Op | undefined => levels[level].get(peek() ?? "");
    const binary = (level: number): bigint | null => {
        if (level < 0) return unary();
        let left = binary(level - 1);
        for (let op = opAt(level); op; op = opAt(level)) {
            i++;
            const right = binary(level - 1);
            left = left === null || right === null ? null : fit(op(left, right));
        }
        return left;
    };
    const and = (): bigint | null => {
        let left = binary(levels.length - 1);
        while (take("&&")) {
            const right = binary(levels.length - 1);
            left = left === 0n || right === 0n ? 0n : left === null || right === null ? null : 1n;
        }
        return left;
    };
    const or = (): bigint | null => {
        let left = and();
        while (take("||")) {
            const right = and();
            left = (left !== null && left !== 0n) || (right !== null && right !== 0n) ? 1n : left === null || right === null ? null : 0n;
        }
        return left;
    };
    const ternary = (): bigint | null => {
        const c = or();
        if (!take("?")) return c;
        const a = ternary();
        if (!take(":")) fail();
        const b = ternary();
        return c === null ? (a !== null && a === b ? a : null) : c !== 0n ? a : b;
    };
    try {
        const v = ternary();
        return i === toks.length ? v : null;
    } catch {
        return null;
    }
};

/** A pragma's text: those that make a name weak or rename it, and those that restore a macro. */
const pragmaNames = (text: string, names: Set<string>): boolean => {
    const m = /^\s*(?:weak|redefine_extname)\s+([\s\S]*)$/.exec(text);
    if (m) for (const n of m[1].matchAll(/[A-Za-z_]\w*/g)) names.add(n[0]);
    return /^\s*pop_macro\b/.test(text);
};

/** A file's directives, conditional branches, includes and macros. */
export const readPreproc = (text: string): Preproc => {
    const directives: Directive[] = [];
    for (const m of text.matchAll(TOKENS)) if (m[1] !== undefined) directives.push({ name: m[1].replace(SPLICES, ""), rest: clean(m[2] ?? ""), start: m.index!, end: m.index! + m[0].length });
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    // The branches as spans: each opens after its directive and closes at the next directive of its conditional.
    type Span = { from: number; to: number; branch: Branch; depth: number };
    const spans: Span[] = [];
    /** Each open conditional: its current branch, whether that branch can never be compiled, and whether an earlier one always is. */
    const open: { at: number; index: number; from: number; dead: boolean; taken: boolean; conds: string[] }[] = [];
    let unbalanced = false;
    const close = (to: number) => {
        const top = open[open.length - 1];
        spans.push({ from: top.from, to, depth: open.length, branch: { at: top.at, index: top.index, dead: top.dead, conds: top.conds.join("\n") } });
    };
    for (const d of directives) {
        const value = d.name === "if" || d.name === "elif" ? constantOf(d.rest) : null;
        if (d.name === "if" || d.name === "ifdef" || d.name === "ifndef") open.push({ at: d.start, index: 0, from: d.end, dead: value === 0n, taken: value !== null && value !== 0n, conds: [condition(d)] });
        else if (d.name === "elif" || d.name === "elifdef" || d.name === "elifndef" || d.name === "else") {
            if (open.length === 0) {
                unbalanced = true;
                continue;
            }
            close(d.start);
            const top = open[open.length - 1];
            open[open.length - 1] = { at: top.at, index: top.index + 1, from: d.end, dead: top.taken || value === 0n, taken: top.taken || (value !== null && value !== 0n), conds: [...top.conds, condition(d)] };
        } else if (d.name === "endif") {
            if (open.length === 0) {
                unbalanced = true;
                continue;
            }
            close(d.start);
            open.pop();
        }
    }
    if (open.length > 0) unbalanced = true;
    while (open.length > 0) {
        close(text.length);
        open.pop();
    }
    // A header's include guard: one `#ifndef X` / `#define X` (or `#if !defined(X)`) holding every directive and all the code.
    let guard = -1;
    let guardName: string | null = null;
    const first = directives[0];
    if (first && !unbalanced) {
        const name = first.name === "ifndef" ? first.rest : first.name === "if" ? (/^!\s*defined\s*\(?\s*(\w+)\s*\)?$/.exec(first.rest)?.[1] ?? "") : "";
        const def = directives[1];
        const last = directives[directives.length - 1];
        const outside = (from: number, to: number) => text.slice(from, to).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "").trim() === "";
        if (name && def?.name === "define" && def.rest.split(/\s+/)[0] === name && last.name === "endif" && outside(0, first.start) && outside(last.end, text.length)) {
            const span = spans.find((s) => s.branch.at === first.start && s.branch.index === 0);
            if (span && span.to === last.start) {
                guard = first.start;
                guardName = name;
            }
        }
    }
    const kept = spans.filter((s) => s.branch.at !== guard).sort((a, b) => a.from - b.from);
    const branchesAt = (offset: number): Branch[] =>
        kept
            .filter((s) => s.from <= offset && offset < s.to)
            .sort((a, b) => a.depth - b.depth)
            .map((s) => s.branch);
    const includes: Include[] = [];
    const macros: Macro[] = [];
    const macroNames = new Set<string>();
    const pops: number[] = [];
    for (const d of directives) {
        if (d.name === "include" || d.name === "include_next" || d.name === "import") {
            const m = /^(?:"([^"]+)"|<([^>]+)>)/.exec(d.rest);
            const macro = m ? undefined : /^([A-Za-z_]\w*)$/.exec(d.rest)?.[1];
            // `#include_next` reads the next header of a name on the include path, which the board can't know: none named.
            if (d.name === "include_next") includes.push({ spec: "", angle: true, start: d.start, line: lineAt(starts, d.start) });
            else includes.push({ spec: m ? (m[1] ?? m[2]) : "", angle: !!m?.[2], start: d.start, line: lineAt(starts, d.start), ...(macro ? { macro } : {}) });
        } else if (d.name === "define") {
            const m = /^([A-Za-z_]\w*)(\(([^)]*)\))?\s*([\s\S]*)$/.exec(d.rest);
            if (!m) continue;
            macroNames.add(m[1]);
            const params = m[2] !== undefined ? m[3].split(",").map((p) => p.trim()).filter(Boolean) : null;
            const variadic = !!params && params.length > 0 && params[params.length - 1].endsWith("...");
            macros.push({ name: m[1], params: params ? params.map((p) => (p === "..." ? "__VA_ARGS__" : p.replace(/\.\.\.$/, ""))) : null, variadic, body: m[4], start: d.start });
        } else if (d.name === "undef") {
            const m = /^([A-Za-z_]\w*)/.exec(d.rest);
            if (m) macroNames.add(m[1]);
        } else if (d.name === "pragma" && pragmaNames(d.rest, macroNames)) pops.push(d.start);
    }
    // The pragma operators, wherever written: `_Pragma("…")` and MSVC's `__pragma(…)`.
    for (const m of text.matchAll(/\b_Pragma\s*\(\s*L?"((?:\\.|[^"\\])*)"\s*\)|\b__pragma\s*\(((?:[^()]|\([^()]*\))*)\)/g)) {
        if (pragmaNames(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2], macroNames)) pops.push(m.index!);
    }
    return { directives, branchesAt, includes, macros, macroNames, pops, guard: guardName, unbalanced };
};

/** Whether branches `inner` sit in every branch of `outer`: code under `inner` is compiled only when code under `outer` is. */
export const within = (inner: readonly Branch[], outer: readonly Branch[]): boolean => outer.length <= inner.length && outer.every((b, i) => inner[i].at === b.at && inner[i].index === b.index);

/** Names a condition reads that differ from one place to the next. */
const PLACE_NAMES = new Set(["__LINE__", "__COUNTER__", "__INCLUDE_LEVEL__"]);

/**
 * `within`, where a branch may also be another conditional's with the same
 * conditions written up to it (curl's `#ifndef CURL_DISABLE_MIME` around a
 * function and again around its call), so long as nothing between offsets
 * `from` and `to` of the file includes a header, defines or undefines a name
 * the conditions read, or one the macros they read read in turn (`defs`
 * every definition visible), or restores a macro (`pop_macro`); and none
 * reads a name whose value is the place (`__LINE__`). The conditions then
 * read the same.
 */
export const withinAlike = (p: Preproc, inner: readonly Branch[], outer: readonly Branch[], from: number, to: number, defs: (name: string) => readonly Macro[] | undefined = () => undefined): boolean => {
    if (outer.length > inner.length) return false;
    const names = new Set<string>();
    const add = (text: string) => {
        for (const m of text.matchAll(/[A-Za-z_]\w*/g)) {
            if (m[0] === "defined" || names.has(m[0])) continue;
            names.add(m[0]);
            for (const d of defs(m[0]) ?? []) add(d.body);
        }
    };
    for (const [i, b] of outer.entries()) {
        const c = inner[i];
        if (c.at === b.at && c.index === b.index) continue;
        if (c.index !== b.index || c.conds !== b.conds) return false;
        add(b.conds);
    }
    if (names.size === 0 && outer.every((b, i) => inner[i].at === b.at)) return true;
    if ([...names].some((n) => PLACE_NAMES.has(n))) return false;
    const [lo, hi] = from < to ? [from, to] : [to, from];
    if (p.pops.some((o) => o > lo && o < hi)) return false;
    return !p.directives.some((d) => d.start > lo && d.start < hi && (/^(?:include|include_next|import)$/.test(d.name) || ((d.name === "define" || d.name === "undef") && names.has(/^[A-Za-z_]\w*/.exec(d.rest)?.[0] ?? ""))));
};

/**
 * Whether a macro hands its argument at `index` to its expansion as code, in
 * every definition: the parameter appears at least once on its own (not
 * stringified, pasted, or after `.` or `->`) where each macro the body calls
 * around it (`lookup`; a parameter called is unknown) hands it on too.
 */
export const passesArgument = (defs: readonly Macro[], index: number, lookup: (macro: string) => readonly Macro[] | undefined = () => undefined, depth = 0): boolean =>
    depth <= 8 &&
    defs.length > 0 &&
    defs.every((m) => {
        if (!m.params) return false;
        const last = m.params.length - 1;
        const param = m.variadic && index >= last ? m.params[last] : index < m.params.length ? m.params[index] : null;
        if (!param) return false;
        const body = m.body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
        const tokens = [...body.matchAll(/[A-Za-z_]\w*|##|#|->|\.\.\.|\.|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S/g)].map((t) => t[0]);
        return tokens.some((t, i) => {
            if (t !== param) return false;
            const before = tokens[i - 1];
            const after = tokens[i + 1];
            if (before === "#" || before === "##" || after === "##" || before === "." || before === "->") return false;
            // The calls open around it in the body: each a function's, or a macro's that hands it on in turn.
            const open: { callee: string; index: number }[] = [];
            for (let k = 0; k < i; k++) {
                if (tokens[k] === "(") open.push({ callee: /^[A-Za-z_]/.test(tokens[k - 1] ?? "") ? tokens[k - 1] : "", index: 0 });
                else if (tokens[k] === ")") open.pop();
                else if (tokens[k] === "," && open.length > 0) open[open.length - 1].index++;
            }
            return open.every((c) => {
                if (m.params!.includes(c.callee)) return false;
                const inner = lookup(c.callee);
                return !inner || passesArgument(inner, c.index, lookup, depth + 1);
            });
        });
    });
