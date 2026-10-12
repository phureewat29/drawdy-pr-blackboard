/**
 * What a macro's tokens say. In the standard library's expression macros
 * (`format!`, `assert_eq!`, ...) only calls count, of names the macro's own
 * tokens don't bind, nested ones included; other macros' tokens prove
 * nothing.
 */

import { child, namedChildren, textOf, type Flat } from "../../syntax.ts";
import { previous } from "./nodes.ts";

/** Macros whose arguments are ordinary expressions. */
const EXPRESSION_MACROS = new Set([
    "println", "print", "eprintln", "eprint", "format", "format_args", "write", "writeln", "panic", "assert", "assert_eq", "assert_ne",
    "debug_assert", "debug_assert_eq", "debug_assert_ne", "vec", "matches", "dbg", "todo", "unimplemented", "unreachable",
]);

/** The expression macro whose tokens hold an identifier, through nested token trees, or -1. */
export const expressionMacro = (t: Flat, n: number): number => {
    let m = t.parent[n];
    while (m >= 0 && t.type[m] === "token_tree") m = t.parent[m];
    if (m < 0 || t.type[m] !== "macro_invocation") return -1;
    const name = child(t, m, "macro");
    return name >= 0 && EXPRESSION_MACROS.has(textOf(t, name)) ? m : -1;
};

export const opensCall = (t: Flat, n: number) => n >= 0 && t.type[n] === "token_tree" && t.text[t.start[n]] === "(";

/** Keywords a macro's tokens may hold as identifiers: none of them ends an operand. */
const KEYWORDS = new Set("as async await break const continue dyn else enum extern fn for if impl in let loop match mod move mut pub ref return static struct trait type unsafe use where while yield box try macro".split(" "));

/**
 * Whether a token ends an operand, so a `|` after it is a bitwise or: a
 * name that isn't a keyword or a label (`'outer`), a literal, a primitive
 * type (`x as u32`), `self`, a `(...)` group, a `[...]` group that isn't an
 * attribute (`#[...]`), `?`. After anything else a `|` opens a closure's
 * parameters, so a case not foreseen binds its names and links nothing.
 */
const endsOperand = (t: Flat, prev: number): boolean => {
    if (prev < 0) return false;
    const ty = t.type[prev];
    const before = previous(t, prev);
    if (ty === "identifier") return !KEYWORDS.has(textOf(t, prev)) && !(before >= 0 && t.type[before] === "'");
    if (ty === "token_tree") return t.text[t.start[prev]] === "(" || (t.text[t.start[prev]] === "[" && !(before >= 0 && t.type[before] === "#"));
    return ty === "?" || ty === "self" || ty === "super" || ty === "crate" || ty === "primitive_type" || ty.endsWith("_literal");
};

/**
 * The names a macro's tokens bind, which are no uses anywhere in them: a
 * closure's parameters (any name between two `|` of one token tree, so an
 * operand of `a | b` counts too), a `let` or `for` pattern, a `match` arm's
 * pattern, a named format argument (`path = p`), and everything `matches!`
 * matches against. A token tree inside a pattern is all pattern:
 * `|(_, v)|`, `if let Some(v) =`.
 */
const boundCache = new WeakMap<Flat, Map<number, Set<string>>>();
export const macroBound = (t: Flat, macro: number): Set<string> => {
    let byMacro = boundCache.get(t);
    if (!byMacro) boundCache.set(t, (byMacro = new Map()));
    let hit = byMacro.get(macro);
    if (hit) return hit;
    const bound = (hit = new Set<string>());
    byMacro.set(macro, bound);
    // `matches!(e, Pattern if guard)`: what follows the first comma is a pattern, here or in a `matches!` among the tokens.
    // A `match`'s braces hold its arms: each arm's pattern runs to its `=>`, its body to a comma or past a braced block.
    const walk = (tree: number, mode: "expr" | "matches" | "pattern" | "arms") => {
        let pipes = 0;
        let binding = false;
        let commas = 0;
        let arm = mode === "arms";
        let armBody = false;
        let matchArms = false;
        for (let c = t.first[tree], prev = -1, prev2 = -1; c >= 0; prev2 = prev, prev = c, c = t.next[c]) {
            const ty = t.type[c];
            const inPattern = mode === "pattern" || (mode === "matches" && commas > 0) || pipes % 2 === 1 || binding || arm;
            if (ty === "token_tree") {
                const matches = prev >= 0 && t.type[prev] === "!" && prev2 >= 0 && t.type[prev2] === "identifier" && textOf(t, prev2) === "matches";
                const braces = t.text[t.start[c]] === "{";
                if (inPattern) walk(c, "pattern");
                else if (matchArms && braces) walk(c, "arms");
                else walk(c, matches ? "matches" : "expr");
                if (matchArms && braces) matchArms = false;
                // An arm whose body is a block ends with it.
                else if (armBody && braces && prev >= 0 && t.type[prev] === "=>") (armBody = false), (arm = true);
                continue;
            }
            // A `|` is a bitwise or right after an operand; anywhere else it opens a closure's parameters, or closes them.
            if (ty === "|" && (pipes % 2 === 1 || !endsOperand(t, prev))) pipes++;
            else if (ty === ",") {
                commas++;
                if (mode === "arms" && armBody) (armBody = false), (arm = true);
            }
            if (ty === "let" || ty === "for") binding = true;
            else if (ty === "=" || ty === ";" || (ty === "identifier" && binding && textOf(t, c) === "in")) binding = false;
            if (ty === "match") matchArms = true;
            if (ty === "=>" && mode === "arms") (arm = false), (armBody = true);
            if (ty !== "identifier") continue;
            const next = t.next[c];
            const named = next >= 0 && t.type[next] === "=" && !(t.next[next] >= 0 && t.type[t.next[next]] === "=");
            if (inPattern || named) bound.add(textOf(t, c));
        }
    };
    const tokens = namedChildren(t, macro).find((c) => t.type[c] === "token_tree");
    if (tokens !== undefined) walk(tokens, textOf(t, child(t, macro, "macro")) === "matches" ? "matches" : "expr");
    return bound;
};

/** A token that ends a receiver: `self`, or an identifier no token before it joins to another (`a.b.f(` and `a::b.f(` aren't read). */
export const loneReceiver = (t: Flat, n: number) => {
    if (n < 0 || !(t.type[n] === "self" || t.type[n] === "identifier")) return false;
    const before = previous(t, n);
    return !(before >= 0 && !t.named[before] && (t.type[before] === "." || t.type[before] === "::"));
};
