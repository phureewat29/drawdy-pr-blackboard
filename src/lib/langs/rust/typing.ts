/**
 * What Rust's resolver reads: `self` and `Self` mean the impl around them,
 * none for an impl inside a function. A type's methods are its inherent
 * impls' (`impl T`), never a trait's: an inherent method wins, and a trait
 * method may be implemented anywhere, though the method probe may reach a
 * trait's first (`probe.ts`) and an impl may lend to some receivers only
 * (`impls.ts`).
 */

import type { Hint, Resolver, Typing, TypeName } from "../../anylink.ts";
import { child, namedChildren, textOf, type Flat } from "../../syntax.ts";
import { lendsTo } from "./impls.ts";
import { selfClass } from "./nodes.ts";
import { shadowed, traitModes } from "./probe.ts";

const typeName = (t: Flat, n: number): TypeName | null => {
    if (n < 0) return null;
    switch (t.type[n]) {
        case "type_identifier":
            return textOf(t, n) === "Self" ? { kind: "self" } : { kind: "name", node: n };
        case "reference_type":
        case "pointer_type":
            return typeName(t, child(t, n, "type"));
        case "generic_type": {
            const inner = child(t, n, "type");
            return inner >= 0 && t.type[inner] === "type_identifier" && textOf(t, inner) === "Self" ? { kind: "self" } : typeName(t, inner);
        }
        case "scoped_type_identifier":
            return { kind: "qualified", qualifier: child(t, n, "path"), name: textOf(t, child(t, n, "name")) };
        default:
            return null;
    }
};

const hint = (t: Flat, e: number): Hint | null => {
    switch (t.type[e]) {
        case "self":
            return { kind: "self" };
        case "identifier":
        case "type_identifier":
            return textOf(t, e) === "Self" ? { kind: "selfclass" } : { kind: "name", node: e };
        case "field_expression":
            return { kind: "member", object: child(t, e, "value"), name: textOf(t, child(t, e, "field")) };
        case "scoped_identifier":
        case "scoped_type_identifier":
            return child(t, e, "path") >= 0 ? { kind: "path", qualifier: child(t, e, "path"), name: textOf(t, child(t, e, "name")) } : null;
        case "generic_function":
            return hint(t, child(t, e, "function"));
        case "call_expression": {
            let fn = child(t, e, "function");
            if (fn >= 0 && t.type[fn] === "generic_function") fn = child(t, fn, "function");
            return { kind: "call", callee: fn };
        }
        case "struct_expression":
            return { kind: "new", type: child(t, e, "name") };
        case "reference_expression":
            return hint(t, child(t, e, "value"));
        case "parenthesized_expression":
            return hint(t, namedChildren(t, e)[0] ?? -1);
        default:
            return null;
    }
};

const PRELUDE = new Set(
    "Some None Ok Err Box Vec String Option Result drop Default Clone Copy Send Sync Sized ToString ToOwned Into From Iterator IntoIterator Fn FnMut FnOnce Drop PartialEq Eq PartialOrd Ord AsRef AsMut Debug std core alloc".split(" ")
);

const RUST_TYPING: Typing = {
    hint,
    typeName,
    returnType: (t, n) => (t.type[n] === "function_item" ? child(t, n, "return_type") : -1),
    // An impl's methods belong to the type it implements; only an inherent impl lends them.
    ownerType: (t, n) => (t.type[n] === "impl_item" ? child(t, n, "type") : -1),
    ownsMembers: (t, n) => t.type[n] !== "impl_item" || child(t, n, "trait") < 0,
    nests: (t, n) => t.type[n] === "trait_item",
    fields: (t, n) => {
        if (t.type[n] !== "struct_item") return [];
        const body = child(t, n, "body");
        if (body < 0 || t.type[body] !== "field_declaration_list") return [];
        return namedChildren(t, body)
            .filter((fd) => t.type[fd] === "field_declaration")
            .map((fd) => ({ name: textOf(t, child(t, fd, "name")), typeNode: child(t, fd, "type"), init: -1, onSelf: false }));
    },
    moduleNameKeys: true,
    // `x.f` without a call is a field; `T::f` names the method itself.
    memberIsField: (t, n) => t.type[t.parent[n]] === "field_expression" || t.type[t.parent[n]] === "token_tree",
    // The `a` of `a::b` is a type, a module or a crate: types and functions have names of their own.
    typeOnly: (t, n) => (t.type[t.parent[n]] === "scoped_identifier" || t.type[t.parent[n]] === "scoped_type_identifier") && t.field[n] === "path",
    builtins: PRELUDE,
    selfClass,
    traitModes,
    shadowed,
    lendsTo,
};

export const RUST_RESOLVER: Resolver = { typing: RUST_TYPING, moduleFiles: () => [] };
