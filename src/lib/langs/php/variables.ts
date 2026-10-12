/**
 * PHP's variables belong to their function. What a variable holds where it
 * is read: the value of the nearest `$x = …` that runs right before, in the
 * blocks around the read (no other write between them, but in another
 * branch of an `if` or a ternary, none in a loop around it that could run
 * again first), or the parameter's own value when no write runs before.
 * An inline `@var` tag, PHPStan's type for it from there on, counts as a
 * write. A variable a reference may change at any time (`&$x`, `global`,
 * `static`, a closure's `use (&$x)`), or any variable of a function that
 * reaches its variables by name (`$$x`, `extract`, `include`, `goto`),
 * holds nothing known.
 */

import { memoize } from "../../fp.ts";
import { child, namedChildren, prevSibling, textOf, type Flat } from "../../syntax.ts";
import { FUNCTIONS, lastOf, nameText } from "./nodes.ts";

/**
 * A variable's writes in its function, the value each plain `$x = …` gives,
 * its parameter, how a closure takes it, whether a reference may write it,
 * where it is passed whole to a call (`f($x)`): one taking it by reference
 * may write it then, or later through a reference it keeps; and the values
 * an inline PHPDoc above their `$x = …;` types (`@var Foo $x`), with it.
 */
export type Var = { writes: number[]; values: Map<number, number>; param: number; use: "value" | "ref" | null; aliased: boolean; passed: number[]; doc: Map<number, number> };

/** An inline PHPDoc's `@var` tag: the variable it names before its type (`@var $x Foo`), the type, brackets and all, and the variable it names after it, if any. */
export const VAR_TAG = /@(?:phpstan-|psalm-)?var\s+(?:\$(\w+)\s+)?((?:[^\s{<(]|\{[^}]*\}|<[^>]*>|\([^)]*\))+)(?:\s+\$(\w+))?/g;

/** How a variable node is written: null when read; the value of a plain `$x = …`; "write" for any other write; "alias" where a reference may write it later. */
const writeOf = (t: Flat, n: number): number | "write" | "alias" | null => {
    const p = t.parent[n];
    const pt = t.type[p];
    const f = t.field[n];
    if (pt === "by_ref" || pt === "global_declaration" || pt === "static_variable_declaration" || pt === "reference_assignment_expression") return "alias";
    if (pt === "assignment_expression" && f === "left") return child(t, p, "right");
    if ((pt === "augmented_assignment_expression" && f === "left") || (pt === "update_expression" && f === "argument") || pt === "unset_statement" || pt === "catch_clause") return "write";
    // Destructuring, `[$a, $b] = …` and `foreach (… as $k => $v)`: a target is the variable itself, in a list or a pair, not an index or a value read.
    let x = n;
    while (["list_literal", "array_creation_expression", "array_element_initializer", "pair"].includes(t.type[t.parent[x]])) x = t.parent[x];
    const top = t.type[t.parent[x]];
    return x !== n && top.includes("assignment") && t.field[x] === "left" ? "write" : top === "foreach_statement" && namedChildren(t, t.parent[x])[0] !== x && t.field[x] !== "body" ? "write" : null;
};

/** The variables of a function-like node: each one's writes, outside the functions and classes it holds. */
export const varsOf = memoize(
    (t: Flat) =>
        memoize((fn: number) => {
            const vars = new Map<string, Var>();
            let dynamic = false;
            const named = (key: string): Var => {
                let x = vars.get(key);
                if (!x) vars.set(key, (x = { writes: [], values: new Map(), param: -1, use: null, aliased: false, passed: [], doc: new Map() }));
                return x;
            };
            const v = (name: number): Var => named(textOf(t, name).slice(1));
            /** The variable of a closure's `use` item, by reference or not. */
            const used = (u: number) => (t.type[u] === "by_ref" ? namedChildren(t, u)[0] : u);
            for (const p of namedChildren(t, child(t, fn, "parameters"))) if (t.type[child(t, p, "name")] === "variable_name") v(child(t, p, "name")).param = p;
            for (const c of namedChildren(t, fn)) if (t.type[c] === "anonymous_function_use_clause") for (const u of namedChildren(t, c)) v(used(u)).use = u === used(u) ? "value" : "ref";
            const body = child(t, fn, "body");
            for (let n = body, last = body < 0 ? -1 : lastOf(t, body); n >= 0 && n <= last; n++) {
                const ty = t.type[n];
                // A nested function, closure or class has variables of its own; a closure's `use (&$x)` may write ours whenever it runs.
                if (n !== body && (FUNCTIONS.has(ty) || ty.endsWith("class") || ty === "class_declaration")) {
                    for (const c of namedChildren(t, n)) if (t.type[c] === "anonymous_function_use_clause") for (const u of namedChildren(t, c)) if (u !== used(u)) v(used(u)).aliased = true;
                    n = lastOf(t, n);
                } else if (ty === "comment") {
                    // An inline `@var Foo $x` types $x from there on, as PHPStan reads it: above `$x = …;` that value, elsewhere a write of its own.
                    for (const [, before, , after] of textOf(t, n).matchAll(VAR_TAG)) {
                        const name = before ?? after;
                        const next = namedChildren(t, t.type[t.next[n]] === "expression_statement" ? t.next[n] : -1)[0];
                        const left = t.type[next] === "assignment_expression" ? child(t, next, "left") : -1;
                        if (t.type[left] === "variable_name" && (!name || textOf(t, left) === `$${name}`)) v(left).doc.set(child(t, next, "right"), n);
                        else if (name) named(name).writes.push(n);
                    }
                } else if (ty === "dynamic_variable_name" || ty === "goto_statement" || ty.startsWith("include") || ty.startsWith("require") || (ty === "function_call_expression" && /^\\?(extract|parse_str|eval)$/i.test(nameText(t, child(t, n, "function"))))) dynamic = true;
                else if (ty === "variable_name") {
                    const w = writeOf(t, n);
                    if (t.type[t.parent[n]] === "argument") v(n).passed.push(n);
                    if (w === null) continue;
                    const x = v(n);
                    x.writes.push(n);
                    if (w === "alias") x.aliased = true;
                    else if (w !== "write") x.values.set(n, w);
                }
            }
            return { dynamic, vars };
        }),
    { cache: new WeakMap() }
);

/** Nodes whose statements run in order. */
const BLOCKS = new Set(["compound_statement", "colon_block", "case_statement", "default_statement"]);

export const LOOPS = /^(while|do|for|foreach)_statement$/;

/**
 * The write a variable's read sees: the value of the nearest plain
 * `$x = …;` statement before it in a block around it; "start" when no write
 * runs before it in its function; null when another kind of write may.
 */
export const reachOf = (t: Flat, fn: number, n: number, v: Var): number | "start" | null => {
    const inside = (w: number, node: number) => node >= 0 && t.start[node] <= t.start[w] && t.start[w] < t.end[node];
    const writesIn = (node: number, but = -1) => v.writes.filter((w) => inside(w, node) && !inside(w, but));
    for (let x = n; ; ) {
        const p = t.parent[x];
        if (p < 0 || x === fn) return null;
        const pt = t.type[p];
        if (BLOCKS.has(pt)) {
            for (let s = prevSibling(t, x); s >= 0; s = prevSibling(t, s)) {
                const ws = writesIn(s);
                if (ws.length === 0) continue;
                const value = ws.length === 1 ? v.values.get(ws[0]) : undefined;
                return value !== undefined && t.type[s] === "expression_statement" && t.parent[ws[0]] === namedChildren(t, s)[0] ? value : null;
            }
            if (p === child(t, fn, "body")) return "start";
        } else if (LOOPS.test(pt)) {
            // A write anywhere in a loop may run before the read's next turn.
            if (writesIn(p).length > 0) return null;
        } else if (pt === "if_statement" || pt === "conditional_expression") {
            // One branch runs: only the conditions run before it, `if`'s and every `elseif`'s.
            if ([p, ...namedChildren(t, p).filter((c) => t.type[c] === "else_if_clause")].some((c) => child(t, c, "condition") !== x && writesIn(child(t, c, "condition")).length > 0)) return null;
        } else if (pt === "assignment_expression" && t.field[x] === "right") {
            // `$x = $x->next()`: the right side runs before the write.
            if (writesIn(p, x).some((w) => w !== child(t, p, "left"))) return null;
        } else if (writesIn(p, x).length > 0) return null;
        x = p;
    }
};
