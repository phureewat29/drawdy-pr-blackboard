/**
 * Parse gaps: an ERROR node, or a token tree-sitter supplied (MISSING, of no
 * width). What code around a gap declares or names may not be what it writes.
 */

import { perTree, type Flat } from "../../syntax.ts";
import { lastDescendant, TYPE_DECLARATIONS } from "./nodes.ts";

/** How many gaps come before each node. */
const gapsBefore = perTree((t: Flat): Int32Array => {
    const before = new Int32Array(t.count + 1);
    for (let n = 0; n < t.count; n++) before[n + 1] = before[n] + (t.type[n] === "ERROR" || (n > 0 && t.start[n] === t.end[n]) ? 1 : 0);
    return before;
});

/** Whether a node or one under it is a gap. */
export const gapIn = (t: Flat, n: number): boolean => {
    if (n < 0) return false;
    const before = gapsBefore(t);
    return before[lastDescendant(t, n) + 1] - before[n] > 0;
};

/** Whether a type declaration's header (annotations, name, type parameters, supertypes, a record's components) holds a gap. */
export const headerGap = (t: Flat, decl: number): boolean => {
    for (let c = t.first[decl]; c >= 0; c = t.next[c]) if (t.field[c] !== "body" && gapIn(t, c)) return true;
    return false;
};

/** A gap at the top, or in the package clause or an import, leaves the file's every name in doubt. */
const topGap = perTree((t: Flat): boolean => {
    for (let c = t.first[0]; c >= 0; c = t.next[c]) if (t.type[c] === "ERROR" || t.start[c] === t.end[c] || ((t.type[c] === "package_declaration" || t.type[c] === "import_declaration") && gapIn(t, c))) return true;
    return false;
});

const CLASS_BODIES = new Set(["class_body", "interface_body", "annotation_type_body", "enum_body", "enum_body_declarations"]);

/** Whether the code a node is in may not have parsed as written: a gap in the file's top, in a member around it, or in the header of a class around it. */
export const unsureAt = (t: Flat, n: number): boolean => {
    if (topGap(t)) return true;
    for (let x = n, p = t.parent[n]; p >= 0; x = p, p = t.parent[p]) {
        if (CLASS_BODIES.has(t.type[p]) && (TYPE_DECLARATIONS.has(t.type[x]) ? headerGap(t, x) : gapIn(t, x))) return true;
        if (TYPE_DECLARATIONS.has(t.type[p]) && t.field[x] !== "body" && headerGap(t, p)) return true;
    }
    return false;
};
