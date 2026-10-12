/**
 * What Go's resolver reads: a package is the files of one folder with one
 * package clause, every top-level name is the package's and unique in it,
 * and a `_test.go` file's names are seen only by tests. Methods belong to
 * their receiver's type by name within the package; `T(v)` uses T.
 */

import type { Field, Hint, Resolver, Typing } from "../../anylink.ts";
import { child, namedChildren, textOf, type Flat } from "../../syntax.ts";
import { reaches } from "./build.ts";
import { goModuleFiles, isTest } from "./modules.ts";
import { receiverType, typeName } from "./nodes.ts";

const hint = (t: Flat, e: number): Hint | null => {
    switch (t.type[e]) {
        case "identifier":
        case "package_identifier":
            return { kind: "name", node: e };
        case "selector_expression":
            return { kind: "member", object: child(t, e, "operand"), name: textOf(t, child(t, e, "field")) };
        case "call_expression": {
            const fn = child(t, e, "function");
            // `new(T)` is a *T.
            if (fn >= 0 && t.type[fn] === "identifier" && textOf(t, fn) === "new") {
                const arg = namedChildren(t, child(t, e, "arguments"))[0];
                return arg !== undefined ? { kind: "new", type: arg } : null;
            }
            return { kind: "call", callee: fn };
        }
        case "composite_literal":
            return { kind: "new", type: child(t, e, "type") };
        case "unary_expression": {
            const op = child(t, e, "operand");
            return textOf(t, e).startsWith("&") && op >= 0 && t.type[op] === "composite_literal" ? { kind: "new", type: child(t, op, "type") } : null;
        }
        case "parenthesized_expression":
            return hint(t, namedChildren(t, e)[0] ?? -1);
        default:
            return null;
    }
};

/** A function's result type: its only result, or result `index` of a list. */
const returnType = (t: Flat, n: number, index = 0): number => {
    const r = child(t, n, "result");
    if (r < 0) return -1;
    if (t.type[r] !== "parameter_list") return index === 0 ? r : -1;
    const types: number[] = [];
    for (const p of namedChildren(t, r)) {
        const ty = child(t, p, "type");
        let names = 0;
        for (let c = t.first[p]; c >= 0; c = t.next[c]) if (t.field[c] === "name") names++;
        for (let k = 0; k < Math.max(1, names); k++) types.push(ty);
    }
    return types[index] ?? -1;
};

const fields = (t: Flat, n: number): Field[] => {
    if (t.type[n] !== "type_spec") return [];
    const st = child(t, n, "type");
    if (st < 0 || t.type[st] !== "struct_type") return [];
    const list = namedChildren(t, st).find((c) => t.type[c] === "field_declaration_list");
    if (list === undefined) return [];
    const out: Field[] = [];
    for (const fd of namedChildren(t, list)) {
        if (t.type[fd] !== "field_declaration") continue;
        const type = child(t, fd, "type");
        let named = false;
        for (let c = t.first[fd]; c >= 0; c = t.next[c]) {
            if (t.field[c] !== "name") continue;
            named = true;
            out.push({ name: textOf(t, c), typeNode: type, init: -1, onSelf: false });
        }
        // An embedded field is named after its type.
        const tn = named ? null : typeName(t, type);
        if (tn && tn.kind !== "self") out.push({ name: tn.kind === "name" ? textOf(t, tn.node) : tn.name, typeNode: type, init: -1, onSelf: false });
    }
    return out;
};

const PREDECLARED = new Set(
    "append cap clear close complex copy delete imag len make max min new panic print println real recover bool byte comparable complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any true false iota nil".split(" ")
);

/** The name a file's package clause gives its package. */
const ownName = (t: Flat): string | null => {
    const clause = namedChildren(t, 0).find((c) => t.type[c] === "package_clause");
    const name = clause !== undefined ? namedChildren(t, clause)[0] : undefined;
    return name !== undefined ? textOf(t, name) : null;
};

const GO_TYPING: Typing = {
    hint,
    typeName,
    returnType,
    ownerType: (t, n) => (t.type[n] === "method_declaration" ? receiverType(t, n) : -1),
    nests: () => false,
    fields,
    packageKey: (path, t) => {
        const name = ownName(t);
        return name !== null ? `${path.split("/").slice(0, -1).join("/")}#${name}` : null;
    },
    keyByPackage: true,
    sees: (from, to) => !isTest(to) || isTest(from),
    builtins: PREDECLARED,
    reaches,
    ownName,
    conversions: true,
};

export const GO_RESOLVER: Resolver = { typing: GO_TYPING, moduleFiles: goModuleFiles };
