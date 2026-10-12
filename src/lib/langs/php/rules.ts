/**
 * PHP's rule table: tree-sitter-php 0.24.2's nodes and its own `tags.scm`
 * for classes, interfaces, traits, functions and methods, with enums beside
 * them. Only declarations a file or a namespace holds are cards: what a
 * function, a closure or an anonymous class holds belongs to the code
 * around it. The rule table binds no names: PHP's variables belong to
 * their function, and the resolver (`resolver.ts`) reads them there.
 */

import type { GImport, LangRules, Role } from "../../anyfacts.ts";
import { child, namedChildren, perTree, textOf, type Flat } from "../../syntax.ts";
import { CLASS_LIKES, isInstanceof, kindOf, nameText, nested } from "./nodes.ts";

/** Classes, interfaces and traits as classes; functions and methods; not a namespace's line or a property. */
const unit: LangRules["unit"] = (t, capture, node) => {
    const kind = capture === "definition.function" ? "function" : capture === "definition.class" || capture === "definition.interface" ? "class" : null;
    return kind && !nested(t, node) ? { kind, nameNode: child(t, node, "name"), outer: node } : null;
};

/** Where a name is a class's: a type, `extends`, `implements`, a trait's `use`, an attribute, `new`. */
const TYPED = new Set(["named_type", "base_clause", "class_interface_clause", "use_declaration", "attribute", "object_creation_expression"]);

export const CALLS: ReadonlySet<string> = new Set(["member_call_expression", "nullsafe_member_call_expression", "scoped_call_expression"]);

const SKIP: Role = { kind: "skip" };

/** The node a name stands for: a qualified name's last segment stands for the whole name. */
export const siteNode = (t: Flat, n: number): number => (t.type[t.parent[n]] === "qualified_name" ? t.parent[n] : n);

/** A method's name in a call, a function's, or a class's name before `::`, after `new` or `instanceof`, or in a type; no other name (a declaration's, a variable's, a namespace's segment) is a site. */
const role = (t: Flat, n: number): Role => {
    const e = siteNode(t, n);
    const p = t.parent[e];
    const ty = t.type[p];
    const f = t.field[e];
    if (CALLS.has(ty) && f === "name") return { kind: "member", receiver: child(t, p, ty === "scoped_call_expression" ? "scope" : "object"), expr: e };
    const bare: Role = { kind: "bare", expr: e };
    if (ty === "function_call_expression") return f === "function" ? bare : SKIP;
    if (ty === "scoped_call_expression" || ty === "scoped_property_access_expression") return f === "scope" ? bare : SKIP;
    // `Foo::BAR`, `Foo::class`: the class before `::`.
    if (ty === "class_constant_access_expression") return namedChildren(t, p)[0] === e ? bare : SKIP;
    if (ty === "binary_expression") return f === "right" && isInstanceof(t, p) ? bare : SKIP;
    return TYPED.has(ty) ? bare : SKIP;
};

/** Every `use` clause: classes, functions (`use function`) and constants (`use const`), grouped or not. */
const imports = perTree((t: Flat): GImport[] => {
    const out: GImport[] = [];
    for (let n = 0; n < t.count; n++) {
        if (t.type[n] !== "namespace_use_declaration") continue;
        const prefix = nameText(t, namedChildren(t, n).find((c) => t.type[c] === "namespace_name") ?? -1);
        const group = child(t, n, "body");
        for (const c of namedChildren(t, group >= 0 ? group : n)) {
            const path = namedChildren(t, c).find((x) => t.field[x] !== "alias" && (t.type[x] === "name" || t.type[x] === "qualified_name"));
            if (t.type[c] !== "namespace_use_clause" || path === undefined) continue;
            const segs = [prefix, nameText(t, path)].filter(Boolean).join("\\").replace(/^\\/, "").split("\\");
            const alias = child(t, c, "alias");
            const last = t.type[path] === "name" ? path : namedChildren(t, path).filter((x) => t.type[x] === "name").pop()!;
            out.push({ local: alias >= 0 ? textOf(t, alias) : segs[segs.length - 1], spec: segs.slice(0, -1).join("\\"), level: 0, name: segs[segs.length - 1], node: last, bind: alias >= 0 ? alias : last, stmt: n });
        }
    }
    return out;
});

/** The enums tags.scm leaves out. */
const extraUnits: LangRules["extraUnits"] = (t) => {
    const out: { kind: "class"; nameNode: number; outer: number; node: number }[] = [];
    for (let n = 0; n < t.count; n++) if (t.type[n] === "enum_declaration" && !nested(t, n)) out.push({ kind: "class", nameNode: child(t, n, "name"), outer: n, node: n });
    return out;
};

/** `class Foo`, `Foo::run()`, a function `run()`. */
const label: LangRules["label"] = (t, u, parent) => (CLASS_LIKES.has(t.type[u.node]) ? `${kindOf(t.type[u.node])} ${u.name}` : parent ? `${parent.name}::${u.name}()` : `${u.name}()`);

/** A call's method or function, but a first-class callable's (`$x->m(...)`), a value; `new Foo(…)` too, which names the class and calls its constructor (the resolver says both). */
const isCallee: LangRules["isCallee"] = (t, e) => {
    const p = t.parent[e];
    return t.type[namedChildren(t, child(t, p, "arguments"))[0]] !== "variadic_placeholder" && ((CALLS.has(t.type[p]) && t.field[e] === "name") || t.field[e] === "function" || t.type[p] === "object_creation_expression");
};

/** A site names a class but where it names a method or a function. */
const isType: LangRules["isType"] = (t, n) => !/^(name|function)$/.test(t.field[siteNode(t, n)]);

export const PHP_RULES: LangRules = { unit, extraUnits, label, scope: () => null, binds: () => undefined, identifiers: new Set(["name"]), role, isCallee, isType, imports };
