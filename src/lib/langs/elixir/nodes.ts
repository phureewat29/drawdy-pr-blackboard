/** tree-sitter-elixir 0.3.5's nodes as the rule table and the resolver read them: calls, their arguments and arity, definition heads, module names. */

import { child, childOfType, namedChildren, textOf, type Flat } from "../../syntax.ts";

/** The calls that define a function or a macro, as `tags.scm` lists them. */
export const DEFS: ReadonlySet<string> = new Set(["def", "defp", "defmacro", "defmacrop", "defguard", "defguardp", "defdelegate", "defn", "defnp"]);

/** Of those, the ones whose body runs as the module's code when called: `defn` is Nx's, compiled by its own rules. */
export const BODIES: ReadonlySet<string> = new Set(["def", "defp", "defmacro", "defmacrop"]);

/** The calls that open a module of their own. */
export const MODULES: ReadonlySet<string> = new Set(["defmodule", "defprotocol", "defimpl"]);

/** Nodes whose statements a directive (`alias`, `import`, `use`) reaches, from where it stands to the node's end. */
export const SCOPES: ReadonlySet<string> = new Set(["source", "do_block", "else_block", "rescue_block", "catch_block", "after_block", "body", "block"]);

/** The parts of a do-block after its `do` part: what the `do` part sets up doesn't reach them. */
export const SUB_BLOCKS: ReadonlySet<string> = new Set(["else_block", "rescue_block", "catch_block", "after_block"]);

export const opOf = (t: Flat, n: number): string => {
    const op = child(t, n, "operator");
    return op >= 0 ? textOf(t, op) : "";
};

/** A call's name when it calls by a bare name: `f` in `f(x)`. */
export const nameOf = (t: Flat, call: number): string | null => {
    const target = child(t, call, "target");
    return target >= 0 && t.type[target] === "identifier" ? textOf(t, target) : null;
};

export const argsOf = (t: Flat, call: number): number[] => {
    const args = childOfType(t, call, "arguments");
    return args >= 0 ? namedChildren(t, args) : [];
};

export const doBlockOf = (t: Flat, call: number): number => childOfType(t, call, "do_block");

/** Whether a node calls `unquote_splicing`, which spreads arguments no one can count. */
const splices = (t: Flat, n: number): boolean => t.type[n] === "call" && nameOf(t, n) === "unquote_splicing";

/** How many arguments a call passes: a do-block is one more, a keyword list (`[do: …, else: …]`); null when `unquote_splicing` spreads some. */
export const arityOf = (t: Flat, call: number): number | null => {
    const args = argsOf(t, call);
    if (args.some((a) => splices(t, a))) return null;
    return args.length + (doBlockOf(t, call) >= 0 ? 1 : 0);
};

/** The value of `key:` in a call's trailing keyword list: `to: M` in `defdelegate f(a), to: M`; -1 when absent. */
export const option = (t: Flat, call: number, key: string): number => keyword(t, argsOf(t, call), key);

/** The value of `key:` in the last keyword list of some nodes (a call's arguments, a list's items); -1 when absent. */
export const keyword = (t: Flat, nodes: readonly number[], key: string): number => {
    const kws = nodes.filter((a) => t.type[a] === "keywords").pop();
    if (kws === undefined) return -1;
    for (const pair of namedChildren(t, kws)) {
        const k = child(t, pair, "key");
        if (k >= 0 && textOf(t, k).replace(/:\s*$/, "") === key) return child(t, pair, "value");
    }
    return -1;
};

/** A definition's head, `def f(a, b \\ 1) when g` or `def f, do: …`: its name token and the arities it defines, defaults giving several. */
export const headOf = (t: Flat, def: number): { name: number; arities: number[] } | null => {
    let head = argsOf(t, def)[0];
    if (head === undefined) return null;
    if (t.type[head] === "binary_operator" && opOf(t, head) === "when") head = child(t, head, "left");
    if (head >= 0 && t.type[head] === "identifier") return { name: head, arities: [0] };
    if (head < 0 || t.type[head] !== "call") return null;
    const target = child(t, head, "target");
    if (t.type[target] !== "identifier") return null;
    const params = argsOf(t, head);
    if (params.some((p) => splices(t, p))) return null;
    const defaults = params.filter((p) => t.type[p] === "binary_operator" && opOf(t, p) === "\\\\").length;
    const arities: number[] = [];
    for (let k = params.length - defaults; k <= params.length; k++) arities.push(k);
    return { name: target, arities };
};

/** The definition kind of a call, `def`, `defp`, …, when it defines something by name. */
export const defKind = (t: Flat, n: number): string | null => {
    if (t.type[n] !== "call") return null;
    const name = nameOf(t, n);
    return name !== null && DEFS.has(name) && headOf(t, n) !== null ? name : null;
};

/** A module name as written, its segments: `A.B` as an alias, `__MODULE__.B` led by `__MODULE__`; null for anything else (an atom, a variable, a call). */
export const segmentsOf = (t: Flat, n: number): string[] | null => {
    if (n < 0) return null;
    if (t.type[n] === "alias") return textOf(t, n).replace(/\s+/g, "").split(".");
    if (t.type[n] === "identifier" && textOf(t, n) === "__MODULE__") return ["__MODULE__"];
    if (t.type[n] === "dot") {
        const left = segmentsOf(t, child(t, n, "left"));
        const right = child(t, n, "right");
        if (!left || left[0] !== "__MODULE__" || right < 0 || t.type[right] !== "alias") return null;
        return [...left, ...textOf(t, right).replace(/\s+/g, "").split(".")];
    }
    return null;
};
