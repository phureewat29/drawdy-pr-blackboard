/**
 * Elixir's rule table: tree-sitter-elixir 0.3.5's nodes, its own `tags.scm`
 * for the units (`defmodule` and `defprotocol` as modules, every `def`-like
 * as a function) plus `defimpl` blocks, and the sites the resolver reads
 * (`resolver.ts`): a call by name, `M.f(…)`, a pipe into a name, a capture
 * `&f/2`, an `import`'s `only:` entry and a `defdelegate`'s `to:`. The
 * clauses of one function written one after another make one unit.
 */

import type { GImport, LangRules, Role } from "../../anyfacts.ts";
import { child, namedChildren, perTree, textOf, type Flat } from "../../syntax.ts";
import { STRUCTURAL } from "./names.ts";
import { argsOf, defKind, headOf, MODULES, nameOf, opOf, option } from "./nodes.ts";

/** The `defdelegate` call whose `to:` value a node is (`to: M`, `to: __MODULE__.M`), or -1. */
export const delegateOf = (t: Flat, n: number): number => {
    const v = t.type[t.parent[n]] === "dot" && t.field[n] === "right" ? t.parent[n] : n;
    const call = t.parent[t.parent[t.parent[t.parent[v]]]];
    return t.type[t.parent[v]] === "pair" && nameOf(t, call) === "defdelegate" && option(t, call, "to") === v ? call : -1;
};

const SKIP: Role = { kind: "skip" };

/** Each `import M, only: [f: 1]` entry, as an import of `f` from M at its keyword. */
const importsOf = (t: Flat): GImport[] => {
    const out: GImport[] = [];
    for (let n = 0; n < t.count; n++) {
        const only = nameOf(t, n) === "import" ? option(t, n, "only") : -1;
        for (const kws of t.type[only] === "list" ? namedChildren(t, only) : []) {
            for (const pair of t.type[kws] === "keywords" ? namedChildren(t, kws) : []) {
                const key = child(t, pair, "key");
                const name = textOf(t, key).replace(/:\s*$/, "");
                out.push({ local: name, spec: textOf(t, argsOf(t, n)[0]), level: 0, name, node: key, bind: -1, stmt: n });
            }
        }
    }
    return out;
};

const role = (t: Flat, n: number): Role => {
    const p = t.parent[n];
    const f = t.field[n];
    if (t.type[n] === "alias" || textOf(t, n) === "__MODULE__") return delegateOf(t, n) >= 0 ? { kind: "bare", expr: n } : SKIP;
    // `f(…)`; `def f(…)`'s own name; `@doc "…"`'s attribute.
    if (t.type[p] === "call" && f === "target") {
        const head = opOf(t, t.parent[p]) === "when" ? t.parent[t.parent[p]] : t.parent[p];
        if (defKind(t, t.parent[head]) && headOf(t, t.parent[head])!.name === n) return { kind: "decl" };
        return STRUCTURAL.has(textOf(t, n)) || opOf(t, t.parent[p]) === "@" ? SKIP : { kind: "bare", expr: p };
    }
    // `M.f(…)`, `M.f`.
    if (t.type[p] === "dot" && f === "right" && t.field[p] === "target") return { kind: "member", receiver: child(t, p, "left"), expr: t.parent[p] };
    // `x |> f`, `&f/2`.
    if ((f === "right" && opOf(t, p) === "|>") || (f === "left" && opOf(t, p) === "/" && opOf(t, t.parent[p]) === "&")) return { kind: "bare", expr: n };
    return SKIP;
};

export const ELIXIR_RULES: LangRules = {
    // `defmodule A.B` and `defprotocol P` hold their functions; each `def`-like is a function, named by its head.
    unit: (t, capture, node) => {
        const first = argsOf(t, node)[0];
        if (capture === "definition.module" && /^def(module|protocol)$/.test(nameOf(t, node) ?? "") && t.type[first] === "alias") return { kind: "class", nameNode: first, outer: node };
        return capture === "definition.function" && defKind(t, node) ? { kind: "function", nameNode: headOf(t, node)!.name, outer: node } : null;
    },
    // A `defimpl P, for: T` block, and a module not named by an alias (`defmodule __MODULE__.State`), hold their functions as a module does, though `tags.scm` leaves them out.
    extraUnits: (t) => {
        const out: { kind: "class"; nameNode: number; outer: number; node: number }[] = [];
        for (let n = 0; n < t.count; n++) {
            const kind = nameOf(t, n) ?? "";
            const first = MODULES.has(kind) ? argsOf(t, n)[0] : undefined;
            if (first !== undefined && (kind === "defimpl" || t.type[first] !== "alias")) out.push({ kind: "class", nameNode: first, outer: n, node: n });
        }
        return out;
    },
    // A function's clauses written one after another, `def f(0)` then `def f(n)`, are one unit.
    continues: (t, previous, node) => defKind(t, previous) !== null && defKind(t, node) !== null,
    // `defmodule Phoenix.URL`, `defimpl P for List`, `URL.validate()`; a protocol implementation's function, or one of a module whose name is computed, by its name alone.
    label: (t, u, parent) => {
        const kind = nameOf(t, u.node) ?? "";
        const target = option(t, u.node, "for");
        if (MODULES.has(kind)) return `${kind} ${u.name}${kind === "defimpl" && target >= 0 ? ` for ${textOf(t, target)}` : ""}`;
        return parent && nameOf(t, parent.node) !== "defimpl" && /^[\w.]+$/.test(parent.name) ? `${parent.name.split(".").pop()}.${u.name}()` : `${u.name}()`;
    },
    scope: () => null,
    binds: () => undefined,
    identifiers: new Set(["identifier", "alias"]),
    role,
    // `&f/2` is a value, called later if at all.
    isCallee: (t, e) => t.type[e] === "call" || opOf(t, t.parent[e]) === "|>",
    isType: () => false,
    imports: perTree(importsOf),
};
