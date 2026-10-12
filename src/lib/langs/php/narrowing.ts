/**
 * Where code tests a value's class, PHP's type checks narrow it: after
 * `if ($rule instanceof Multi)`, `$rule->m()` is Multi's m, an override of
 * the declared type's. Which branch a call sits in isn't read: every test
 * of an expression in the function its variable belongs to counts, keyed
 * by the expression's text, as PHPStan keys narrowed expressions.
 */

import { memoize } from "../../fp.ts";
import { child, namedChildren, textOf, type Flat } from "../../syntax.ts";
import { classNameNode, FUNCTIONS, isInstanceof, lastOf, nameText } from "./nodes.ts";
import { CALLS } from "./rules.ts";

/** The classes an expression is tested against, by its text: a class name's node, an expression whose class it is compared with (`$a === $b`), or "?" for one not known; each with the node that tests it. */
type Tests = Map<string, [number | "?", number][]>;

const unwrap = (t: Flat, n: number): number => {
    let x = n;
    while (t.type[x] === "parenthesized_expression") x = namedChildren(t, x)[0] ?? -1;
    return x;
};

/** An expression's key: its text, spaces out, `?->` as `->`. */
const keyOf = (t: Flat, n: number): string => {
    const x = unwrap(t, n);
    return x < 0 ? "" : textOf(t, x).replace(/\s+/g, "").replace(/\?->/g, "->");
};

/** Values no object is: compared with one, they narrow no class. */
const SCALAR = /^(integer|float|string|encapsed_string|heredoc|nowdoc|boolean|null|array_creation_expression)$/;

/** A call's arguments, `new`'s too. */
const argumentsOf = (t: Flat, call: number): number[] => namedChildren(t, namedChildren(t, call).find((c) => t.type[c] === "arguments") ?? -1);

/** A call's argument values, a named argument's name left out. */
const argsOf = (t: Flat, call: number): number[] => argumentsOf(t, call).map((a) => namedChildren(t, a).find((c) => t.field[c] !== "name") ?? -1);

/** Whether a call names an argument (`f(needle: $x)`): its positions say nothing then. */
const named = (t: Flat, call: number): boolean => argumentsOf(t, call).some((a) => child(t, a, "name") >= 0);

/** A call's name, lowercase: a function's last segment, a method's, `__construct` for `new`; "" for a callable value's. */
export const callName = (t: Flat, call: number): string => (t.type[call] === "object_creation_expression" ? "__construct" : nameText(t, child(t, call, t.type[call] === "function_call_expression" ? "function" : "name")).split("\\").pop()!.toLowerCase());

/** A class an argument names: `Foo::class` (its name's node, "?" for `static::class` or `$x::class`), or "?" for a string written as a namespaced class name; -1 for none. */
const classArg = (t: Flat, a: number): number | "?" => {
    const [scope, constant] = t.type[a] === "class_constant_access_expression" ? namedChildren(t, a) : [];
    if (constant !== undefined) return textOf(t, constant).toLowerCase() === "class" ? (classNameNode(t, scope) >= 0 ? scope : "?") : -1;
    return /^(string|encapsed_string)$/.test(t.type[a]) && /^["']\\*\w+(\\+\w+)+["']$/.test(textOf(t, a)) ? "?" : -1;
};

/** PHPUnit's, webmozart/assert's and beberlei/assert's class assertions, whose class may come in a variable (`nullOrIsInstanceOf`, `isAOf`). */
const ASSERTS = /instanceof|isaof|isanyof/;

/** Their identity assertions: `assertSame($a, $e)` narrows `$e` as `$e === $a` does. */
const SAME = /^(assert(not)?same|(not|nullor)?same)$/;

/**
 * Every test in a node's subtree, closures' included: `instanceof`,
 * `is_a()`, `is_subclass_of()`, `get_class($x)`, `get_debug_type($x)`,
 * `get_parent_class($x)` or `$x::class`, which may be compared; `===`,
 * `!==`, `match` arms and `assertSame()`, which narrow each side to the
 * other's class; `in_array()`'s needle; a call given a class and other
 * values (`assertInstanceOf(Foo::class, $x)`), whose PHPDoc may assert
 * their class; and a property's assignment. Where one of PHP's narrowing
 * functions is given a named argument, each of its arguments is tested.
 */
const testsIn = memoize(
    (t: Flat) =>
        memoize((root: number): Tests => {
            const out: Tests = new Map();
            let at = root;
            const add = (e: number, cls: number | "?") => {
                const x = unwrap(t, e);
                if (x < 0) return;
                out.set(keyOf(t, x), [...(out.get(keyOf(t, x)) ?? []), [cls, at]]);
                // `($r = $node->rule()) instanceof Multi` tests $r and what it was given.
                if (t.type[x] === "assignment_expression") for (const side of ["left", "right"]) add(child(t, x, side), cls);
            };
            /** Two values found identical: each has the other's class there, a scalar narrowing none, a constant's unknown. */
            const same = (a: number, b: number) => {
                for (const [x, y] of [[a, b], [b, a]].map((p) => p.map((e) => unwrap(t, e)))) if (y >= 0 && !SCALAR.test(t.type[y])) add(x, classNameNode(t, y) >= 0 ? "?" : y);
            };
            for (let n = root, last = lastOf(t, root); n <= last; n++) {
                const ty = t.type[n];
                const [scope, constant] = ty === "class_constant_access_expression" ? namedChildren(t, n) : [];
                at = n;
                if (ty === "binary_expression" && isInstanceof(t, n)) {
                    const right = child(t, n, "right");
                    add(child(t, n, "left"), classNameNode(t, right) >= 0 ? right : "?");
                } else if (ty === "binary_expression" && /^[!=]==$/.test(t.type[child(t, n, "operator")])) same(child(t, n, "left"), child(t, n, "right"));
                else if (ty === "match_conditional_expression") for (const c of namedChildren(t, child(t, n, "conditional_expressions"))) same(child(t, t.parent[t.parent[n]], "condition"), c);
                else if (ty === "function_call_expression" || CALLS.has(ty)) {
                    const args = argsOf(t, n);
                    const name = callName(t, n);
                    if (ty === "function_call_expression" && /^(is_a|is_subclass_of|get_class|get_debug_type|get_parent_class|in_array)$/.test(name)) for (const a of named(t, n) ? args : args.slice(0, 1)) add(a, "?");
                    // `assertSame(message: …, actual: $e, expected: $a)`: names say which is which, so neither side is known.
                    if (SAME.test(name)) if (named(t, n)) for (const a of args) add(a, "?");
                    else if (args.length > 1) same(args[0], args[1]);
                    const classes = args.map((a) => classArg(t, a)).filter((c) => c !== -1);
                    if (classes.length > 0 || ASSERTS.test(name)) for (const a of args) if (classArg(t, a) === -1) for (const c of classes.length > 0 ? classes : ["?" as const]) add(a, c);
                }
                // `$this->input = new ArrayInput(…)`: an assigned property holds the value's class there, not only its declared one.
                else if (ty === "assignment_expression" && /property_access|member_access/.test(t.type[child(t, n, "left")])) add(child(t, n, "left"), "?");
                else if (constant !== undefined && textOf(t, constant).toLowerCase() === "class" && classNameNode(t, scope) < 0 && t.type[scope] !== "relative_scope") add(scope, "?");
            }
            return out;
        }),
    { cache: new WeakMap() }
);

/** The outermost function a node is in, closures inside it included; outside any function, the file (0). */
const rootOf = (t: Flat, e: number): number => {
    let root = 0;
    for (let x = t.parent[e]; x > 0; x = t.parent[x]) if (FUNCTIONS.has(t.type[x])) root = x;
    return root;
};

/** The tests of an expression in the outermost function it's in, closures inside it included; outside any function, in the file's code: each class, with the node that tests it. */
export const testsWith = (t: Flat, e: number): [number | "?", number][] => testsIn(t)(rootOf(t, e)).get(keyOf(t, e)) ?? [];

/** The classes an expression is tested against. */
export const testsOf = (t: Flat, e: number): (number | "?")[] => testsWith(t, e).map(([cls]) => cls);

/** Each call in a node's subtree, `new` too: its node, its name, the key of what it is called on (`$this` for `self::`), its arguments' keys, and whether one is named. */
const callsIn = memoize(
    (t: Flat) =>
        memoize((root: number): [number, string, string, string[], boolean][] => {
            const out: [number, string, string, string[], boolean][] = [];
            for (let n = root, last = lastOf(t, root); n <= last; n++) {
                if (t.type[n] !== "function_call_expression" && t.type[n] !== "object_creation_expression" && !CALLS.has(t.type[n])) continue;
                const object = child(t, n, "object");
                out.push([n, callName(t, n), object >= 0 ? keyOf(t, object) : t.type[n] === "scoped_call_expression" ? "$this" : "", argsOf(t, n).map((a) => keyOf(t, a)), named(t, n)]);
            }
            return out;
        }),
    { cache: new WeakMap() }
);

/** What a PHPDoc asserts the type of, by function or method name: a parameter's position (-1 for `$this`, -2 for one not found) and the rest of the expression (`->cache`). */
export type Asserted = ReadonlyMap<string, [number, string][]>;

/** Whether a call in an expression's outermost function, the one given aside, asserts its type: a call of a name whose PHPDoc asserts it of `$this`, a parameter or what hangs off one (`$this->cache`), called on or given the expression. */
export const assertedOn = (t: Flat, e: number, asserted: Asserted, except = -1): boolean => {
    const key = keyOf(t, e).toLowerCase();
    return (
        asserted.size > 0 &&
        callsIn(t)(rootOf(t, e)).some(([n, name, object, keys, many]) => n !== except && (asserted.get(name) ?? []).some(([i, rest]) => (i === -1 ? [object] : many || i < 0 ? keys : [keys[i]]).some((k) => `${k}${rest}`.toLowerCase() === key)))
    );
};

/** The tests of an expression but those a node makes (the comparison it was found in): any other may narrow it, a comparison of another value of the same variable too. */
export const otherTests = (t: Flat, e: number, from: number): [number | "?", number][] => testsWith(t, e).filter(([, at]) => at !== from);

/** The calls in an expression's outermost function given it, or what it hangs off (`$this` for `$this->item`), as an argument, by its text. */
export const passesOf = (t: Flat, e: number): number[] => {
    const key = keyOf(t, e);
    return callsIn(t)(rootOf(t, e))
        .filter(([, , , keys]) => keys.some((k) => key === k || key.startsWith(`${k}->`)))
        .map(([n]) => n);
};
