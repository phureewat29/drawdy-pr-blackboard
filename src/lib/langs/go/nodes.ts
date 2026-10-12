/** Go's syntax nodes as the rule table and the resolver read them: tree-sitter-go 0.25.0's. */

import type { TypeName } from "../../anylink.ts";
import { child, namedChildren, textOf, type Flat } from "../../syntax.ts";

export const typeName = (t: Flat, n: number): TypeName | null => {
    if (n < 0) return null;
    switch (t.type[n]) {
        case "type_identifier":
            return { kind: "name", node: n };
        case "pointer_type":
        case "parenthesized_type":
            return typeName(t, namedChildren(t, n)[0] ?? -1);
        case "generic_type":
            return typeName(t, child(t, n, "type"));
        case "qualified_type":
            return { kind: "qualified", qualifier: child(t, n, "package"), name: textOf(t, child(t, n, "name")) };
        default:
            return null;
    }
};

/** A method's receiver type, as written: `*Server`, `List[T]`. */
export const receiverType = (t: Flat, n: number): number => {
    const recv = namedChildren(t, child(t, n, "receiver"))[0];
    return recv !== undefined ? child(t, recv, "type") : -1;
};
