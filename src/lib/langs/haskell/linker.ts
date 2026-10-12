/**
 * Haskell's linker: units alone (`units-only.ts`). Open imports need the
 * other modules' exports, and type class methods dispatch, so it draws no
 * lines yet.
 *
 * A function is one unit from its type signature through its last equation,
 * as each equation is a declaration of its own. A Haddock comment (`-- |`)
 * above a declaration is its doc, though the tree holds it apart, the first
 * one inside the imports.
 */

import type { UnitRule } from "../../anyfacts.ts";
import { child, namedChildren, textOf, type Flat } from "../../syntax.ts";
import { docAbove, unitsOnly } from "../units-only.ts";
import { HASKELL } from "./index.ts";

/** The units query. tree-sitter-haskell 0.23.1 ships no `tags.scm`. */
const UNITS = String.raw`(declarations (signature name: (_) @name) @definition.function)
(declarations (function name: (_) @name) @definition.function)
(declarations (function (infix operator: (_) @name)) @definition.function)
(declarations (bind name: (_) @name) @definition.function)
(declarations (data_type name: (_) @name) @definition.type)
(declarations (newtype name: (_) @name) @definition.type)
(declarations (type_synomym name: (_) @name) @definition.type)
(declarations (class name: (_) @name) @definition.class)
(declarations (instance name: (_) @name) @definition.class)
`;

const doc = docAbove(new Set(["comment", "haddock"]));
const EQUATIONS = new Set(["function", "bind"]);
const KINDS = new Map<string, UnitRule["kind"]>([["signature", "function"], ["function", "function"], ["bind", "function"], ["data_type", "type"], ["newtype", "type"], ["type_synomym", "type"], ["class", "class"], ["instance", "class"]]);
const KEYWORDS = new Map([["data_type", "data"], ["newtype", "newtype"], ["type_synomym", "type"], ["class", "class"], ["instance", "instance"]]);

/** The name a declaration defines: an operator by itself (`<+>`, from `(<+>)` or `a <+> b`), a function written infix (`` a `plus` b ``) by its name. */
const nameOf = (t: Flat, n: number): number => {
    let name = child(t, n, "name");
    if (name < 0 && t.type[n] === "function") {
        for (let c = t.first[n]; c >= 0 && name < 0; c = t.next[c]) if (t.type[c] === "infix") name = child(t, c, "operator");
    }
    while (name >= 0 && (t.type[name] === "prefix_id" || t.type[name] === "infix_id")) name = namedChildren(t, name)[0] ?? -1;
    return name;
};

const unit = (t: Flat, _capture: string, node: number): UnitRule | null => {
    const kind = KINDS.get(t.type[node]);
    const name = nameOf(t, node);
    return kind && name >= 0 ? { kind, nameNode: name, outer: node, doc: doc(t, t.start[node]) } : null;
};

/** An operator's card is named as code calls it alone, `(<+>)`; an instance's by its class and type, `instance Show Tree`. */
const label = (t: Flat, u: { node: number; name: string }): string => {
    const ty = t.type[u.node];
    if (ty === "instance") {
        const patterns = child(t, u.node, "patterns");
        return `instance ${u.name}${patterns >= 0 ? ` ${textOf(t, patterns).replace(/\s+/g, " ")}` : ""}`;
    }
    if (KEYWORDS.has(ty)) return `${KEYWORDS.get(ty)} ${u.name}`;
    return /^[a-z_]/i.test(u.name) ? u.name : `(${u.name})`;
};

/** What may sit between a signature and its equations. */
const ASIDE = new Set(["comment", "haddock", "pragma", "cpp"]);

/** A function's equations join its signature, or the equation before, with no other declaration between (a signature may stand apart from its equations). */
const continues = (t: Flat, previous: number, node: number): boolean => {
    if (!EQUATIONS.has(t.type[node]) || !(EQUATIONS.has(t.type[previous]) || t.type[previous] === "signature")) return false;
    for (let x = t.next[previous]; x >= 0 && x !== node; x = t.next[x]) if (!ASIDE.has(t.type[x])) return false;
    return true;
};

export const HASKELL_LINKER = unitsOnly(
    [HASKELL],
    UNITS,
    { unit, continues, label },
    (t, n) => t.type[n] === "imports"
);
