/**
 * Clojure's linker: the shared file index (`anyfacts.ts`) with Clojure's
 * rule table below, and a resolver of its own (`resolver.ts`), since which
 * forms bind depends on what their heads are; what its names need is read by
 * `wants.ts`. The units are the def forms the units query captures, and
 * those nested where the query can't reach; every symbol is a site.
 */

import type { LangRules, Role } from "../../anyfacts.ts";
import { labelOf } from "../../symbols.ts";
import { textOf, type Flat } from "../../syntax.ts";
import type { RulesLinker, UnitKind } from "../pack.ts";
import { LOAD_TIME } from "./core.ts";
import { nameNode, plainName, symOf, valuesOf } from "./forms.ts";
import { CLOJURE } from "./index.ts";
import { CLOJURE_RESOLVER } from "./resolver.ts";
import { clojureWants } from "./wants.ts";

/** The units query: the language survey's (the grammar ships no `tags.scm`), unchanged. The rule table checks the head itself: the parser keeps only the definition captures, so the predicates on `@head` never run. */
const UNITS = String.raw`; A top-level form whose head is a defining macro: (defn name ...), (def ^:private name ...), (defmethod name dispatch ...)
(source
  (list_lit
    .
    value: (sym_lit name: (sym_name) @head)
    .
    value: (sym_lit name: (sym_name) @name)
    (#any-of? @head "defn" "defn-" "defmacro" "defmulti" "defmethod" "def" "defonce" "defprotocol" "defrecord" "deftype" "definterface" "deftest")) @definition.function)

(source
  (list_lit
    .
    value: (sym_lit name: (sym_name) @head)
    .
    value: (sym_lit name: (sym_name) @name)
    (#eq? @head "ns")) @definition.module)
`;

/** What each def head the units query lists makes a card of; `ns` makes none, its form being the file's imports. */
const KINDS = new Map("function defn defn- defmacro defmulti defmethod deftest|value def defonce|type defprotocol defrecord deftype definterface".split("|").flatMap((g) => g.split(" ").slice(1).map((n) => [n, g.split(" ")[0] as UnitKind])));
const WORDS = new Map([
    ["defprotocol", "protocol"],
    ["defrecord", "record"],
    ["deftype", "type"],
    ["definterface", "interface"],
]);

/** A def form's head and name symbols, as written. */
const defParts = (t: Flat, n: number) => {
    const vs = t.type[n] === "list_lit" ? valuesOf(t, n) : [];
    const head = symOf(t, vs[0] ?? -1)?.name ?? "";
    return KINDS.has(head) && plainName(t, vs[1]) !== null ? { head, name: vs[1], vs } : null;
};

/**
 * The def forms the units query can't reach, being no top-level list: in a
 * reader conditional's branch (`#?(:clj (defn …))`), or inside a form that
 * runs at load time (`(let […] (defn …))`), any number deep.
 */
const nestedUnits = (t: Flat) => {
    const out: { kind: UnitKind; nameNode: number; outer: number; node: number }[] = [];
    const visit = (n: number, top: boolean): void => {
        const type = t.type[n];
        const d = defParts(t, n);
        if (type === "read_cond_lit" || type === "splicing_read_cond_lit") valuesOf(t, n).forEach((x, i) => i % 2 && (type === "read_cond_lit" ? [x] : valuesOf(t, x)).forEach((y) => visit(y, false)));
        else if (d) {
            if (!top) out.push({ kind: KINDS.get(d.head)!, nameNode: nameNode(t, d.name), outer: n, node: n });
        } else if (type === "list_lit" && LOAD_TIME.has(plainName(t, valuesOf(t, n)[0]) ?? "")) valuesOf(t, n).slice(1).forEach((x) => visit(x, false));
    };
    valuesOf(t, 0).forEach((x) => visit(x, true));
    return out;
};

/** A unit's card name: `f()`, `v`, `record R`, a multimethod's method by its dispatch value when short (`area :circle`). */
const label = (t: Flat, u: { node: number; name: string; kind: UnitKind }) => {
    const d = defParts(t, u.node);
    const dispatch = d?.head === "defmethod" && d.vs[2] !== undefined ? textOf(t, d.vs[2]) : "";
    if (d && WORDS.has(d.head)) return `${WORDS.get(d.head)} ${u.name}`;
    return dispatch && dispatch.length <= 24 && !dispatch.includes("\n") ? `${u.name} ${dispatch}` : labelOf({ name: u.name, kind: u.kind }, CLOJURE.id);
};

/** A symbol's role: a name `a/f` is written through `a`. */
const role = (t: Flat, n: number): Role => {
    const sym = t.parent[n];
    for (let c = t.first[sym]; c >= 0; c = t.next[c]) if (t.field[c] === "namespace") return { kind: "path", receiver: c, expr: sym };
    return { kind: "bare", expr: sym };
};

/** Whether a symbol is the first form of a list. */
const isCallee = (t: Flat, expr: number) => (t.type[t.parent[expr]] === "list_lit" || t.type[t.parent[expr]] === "anon_fn_lit") && valuesOf(t, t.parent[expr])[0] === expr;

const RULES: LangRules = {
    unit: (t, _capture, node) => {
        const d = t.parent[node] === 0 ? defParts(t, node) : null;
        return d && { kind: KINDS.get(d.head)!, nameNode: nameNode(t, d.name), outer: node };
    },
    extraUnits: nestedUnits,
    label,
    scope: () => null,
    binds: () => undefined,
    identifiers: new Set(["sym_name"]),
    role,
    isCallee,
    isType: () => false,
    imports: () => [],
};

/** The forms that make a file's imports: `ns`, and `require`, `use`, `import` and `refer` at the top level. */
const IMPORTS = new Set(["ns", "require", "use", "import", "refer", "refer-clojure"]);

/** The grammar takes a NUL character, written raw in a string, for the file's end: a space keeps every offset. */
const prepare = (_grammar: string, text: string) => (text.includes("\0") ? text.replace(/\0/g, " ") : text);

export const CLOJURE_LINKER: RulesLinker = {
    kind: "rules",
    packs: [CLOJURE],
    prepare,
    units: UNITS,
    rules: RULES,
    resolver: CLOJURE_RESOLVER,
    isImport: (t, n) => t.type[n] === "list_lit" && IMPORTS.has(plainName(t, valuesOf(t, n)[0]) ?? ""),
    wants: clojureWants,
};
