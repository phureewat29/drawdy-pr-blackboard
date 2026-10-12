/**
 * Rust's rule table: tree-sitter-rust 0.24.0's nodes, its own `tags.scm` for
 * the units (structs, enums, traits, functions, methods, inline modules) plus
 * impl blocks, and Rust's scoping: the items of a module, blocks, closures,
 * `let`, `if let`, `match` and `for` patterns, each local seen from the end
 * of its statement. A declaration's own name is no use, an associated item's
 * and an enum variant's too. An impl's methods are not seen as bare names
 * inside it (`Self::f`, `self.f`), and an inline `mod` sees its parent only
 * through `use super::*`. Paths into other files (`crate::`, `super::`, other
 * crates) need the crate's `mod` tree, which isn't read: they name nothing.
 */

import type { Emit, GImport, LangRules, Role } from "../../anyfacts.ts";
import { labelOf } from "../../symbols.ts";
import { child, namedChildren, perTree, textOf, type Flat } from "../../syntax.ts";
import { RUST } from "./index.ts";
import { expressionMacro, loneReceiver, macroBound, opensCall } from "./macros.ts";
import { previous } from "./nodes.ts";

/** Every name a pattern binds: identifiers, `ref x`, `mut x`, `x @ ..`, shorthand fields; not paths, types or constants written with `::`. */
const patternNames = (t: Flat, n: number, out: number[] = []): number[] => {
    if (n < 0) return out;
    const ty = t.type[n];
    if (ty === "identifier" || ty === "shorthand_field_identifier") {
        out.push(n);
        return out;
    }
    if (ty === "scoped_identifier" || ty === "type_identifier" || ty === "scoped_type_identifier" || ty === "string_literal" || ty === "integer_literal") return out;
    for (let c = t.first[n]; c >= 0; c = t.next[c]) {
        if (!t.named[c]) continue;
        if ((ty === "tuple_struct_pattern" || ty === "struct_pattern") && t.field[c] === "type") continue;
        if (ty === "field_pattern" && t.field[c] === "name") continue;
        patternNames(t, c, out);
    }
    return out;
};

const useEntries = (t: Flat, n: number, prefix: string[], stmt: number, out: GImport[]) => {
    const ty = t.type[n];
    const segs = (x: number): string[] => (x < 0 ? [] : t.type[x] === "scoped_identifier" ? [...segs(child(t, x, "path")), textOf(t, child(t, x, "name"))] : [textOf(t, x)]);
    if (ty === "scoped_use_list") {
        const base = [...prefix, ...segs(child(t, n, "path"))];
        for (const c of namedChildren(t, child(t, n, "list"))) useEntries(t, c, base, stmt, out);
    } else if (ty === "use_list") {
        for (const c of namedChildren(t, n)) useEntries(t, c, prefix, stmt, out);
    } else if (ty === "use_as_clause") {
        const full = [...prefix, ...segs(child(t, n, "path"))];
        const alias = child(t, n, "alias");
        out.push({ local: textOf(t, alias), spec: full.slice(0, -1).join("::"), level: 0, name: full[full.length - 1], node: -1, bind: alias, stmt });
    } else if (ty === "use_wildcard") {
        const inner = namedChildren(t, n)[0];
        out.push({ local: "", spec: [...prefix, ...segs(inner ?? -1)].join("::"), level: 0, name: "*", node: -1, bind: -1, stmt });
    } else if (ty === "self") {
        out.push({ local: prefix[prefix.length - 1] ?? "self", spec: prefix.slice(0, -1).join("::"), level: 0, name: prefix[prefix.length - 1] ?? null, node: -1, bind: n, stmt });
    } else if (ty === "identifier" || ty === "scoped_identifier" || ty === "crate" || ty === "super") {
        const full = [...prefix, ...segs(n)];
        const last = ty === "scoped_identifier" ? child(t, n, "name") : n;
        out.push({ local: full[full.length - 1], spec: full.slice(0, -1).join("::"), level: 0, name: full[full.length - 1], node: last, bind: last, stmt });
    }
};

const importsOf = (t: Flat): GImport[] => {
    const out: GImport[] = [];
    for (let n = 0; n < t.count; n++) if (t.type[n] === "use_declaration") useEntries(t, child(t, n, "argument"), [], n, out);
    return out;
};

const imports = perTree(importsOf);

/** Nodes whose `name` declares something: an associated item's and an enum variant's too, though neither binds a name. */
const DECLARATIONS = new Set([
    "function_item", "function_signature_item", "struct_item", "enum_item", "union_item", "type_item", "trait_item", "const_item", "static_item", "mod_item",
    "associated_type", "enum_variant", "macro_definition",
]);

/** Whether an item belongs to an impl or a trait: reached as `Self::f`, `T::f` or `x.f`, never by its name alone. */
const associated = (t: Flat, n: number) => {
    const list = t.parent[n];
    const owner = list >= 0 && t.type[list] === "declaration_list" ? t.parent[list] : -1;
    return owner >= 0 && (t.type[owner] === "impl_item" || t.type[owner] === "trait_item");
};

const binds = (t: Flat, n: number, emit: Emit) => {
    switch (t.type[n]) {
        case "function_item":
        case "function_signature_item":
            if (!associated(t, n)) emit(child(t, n, "name"), "def", { unitNode: n });
            return;
        case "parameter": {
            const pat = child(t, n, "pattern");
            const names = patternNames(t, pat);
            for (const id of names) emit(id, "param", names.length === 1 && id === pat ? { typeNode: child(t, n, "type") } : {});
            return;
        }
        case "closure_parameters":
            for (const c of namedChildren(t, n)) if (t.type[c] !== "parameter") for (const id of patternNames(t, c)) emit(id, "param");
            return;
        // A pattern's names are seen after it: before a `let`, and in its own value, the name means the one outside.
        case "let_declaration": {
            const pat = child(t, n, "pattern");
            const names = patternNames(t, pat);
            for (const id of names) emit(id, "local", names.length === 1 && id === pat ? { typeNode: child(t, n, "type"), init: child(t, n, "value"), from: t.end[n] } : { from: t.end[n] });
            return;
        }
        case "let_condition":
            for (const id of patternNames(t, child(t, n, "pattern"))) emit(id, "local", { from: t.end[n] });
            return;
        case "for_expression": {
            const value = child(t, n, "value");
            for (const id of patternNames(t, child(t, n, "pattern"))) emit(id, "local", value >= 0 ? { from: t.end[value] } : {});
            return;
        }
        case "match_pattern":
            for (const id of patternNames(t, n)) emit(id, "local", { from: t.end[n] });
            return;
        case "struct_item":
        case "enum_item":
        case "union_item":
        case "type_item":
        case "trait_item":
            if (!associated(t, n)) emit(child(t, n, "name"), "type", { unitNode: n });
            return;
        case "const_item":
        case "static_item":
        case "mod_item":
            if (!associated(t, n)) emit(child(t, n, "name"), "local");
            return;
        case "type_parameter":
        case "constrained_type_parameter":
        case "optional_type_parameter":
        case "const_parameter": {
            const name = child(t, n, "name") >= 0 ? child(t, n, "name") : (namedChildren(t, n).find((c) => t.type[c] === "type_identifier" || t.type[c] === "identifier") ?? -1);
            if (name >= 0) emit(name, "param");
            return;
        }
        case "extern_crate_declaration": {
            const alias = child(t, n, "alias");
            emit(alias >= 0 ? alias : child(t, n, "name"), "local");
            return;
        }
        case "use_declaration":
            for (const i of imports(t)) if (i.stmt === n && i.bind >= 0) emit(i.bind, "import", { import: i, name: i.local });
            return;
    }
};

const role = (t: Flat, n: number): Role => {
    const p = t.parent[n];
    if (p < 0) return { kind: "bare", expr: n };
    const pt = t.type[p];
    const f = t.field[n];
    const ty = t.type[n];
    // Inside a macro's tokens: only the standard expression macros, and only the calls `f(`, `self.f(`, `x.f(` and `T::f(`, of names its tokens don't bind.
    if (pt === "token_tree") {
        const macro = expressionMacro(t, n);
        if (macro < 0 || ty !== "identifier" || !opensCall(t, t.next[n])) return { kind: "skip" };
        const bound = macroBound(t, macro);
        const prev = previous(t, n);
        const before = prev >= 0 ? previous(t, prev) : -1;
        if (prev >= 0 && !t.named[prev] && t.type[prev] === ".") {
            if (!loneReceiver(t, before) || (t.type[before] === "identifier" && bound.has(textOf(t, before)))) return { kind: "skip" };
            return { kind: "member", receiver: before, expr: n };
        }
        if (prev >= 0 && !t.named[prev] && t.type[prev] === "::") {
            if (before < 0 || t.type[before] !== "identifier" || !loneReceiver(t, before)) return { kind: "skip" };
            return { kind: "path", receiver: before, expr: n };
        }
        return bound.has(textOf(t, n)) ? { kind: "skip" } : { kind: "bare", expr: n };
    }
    // A declaration's own name, an associated item's or an enum variant's among them, names nothing.
    if (f === "name" && DECLARATIONS.has(pt)) return { kind: "decl" };
    if (pt === "field_expression" && f === "field") return { kind: "member", receiver: child(t, p, "value"), expr: p };
    if ((pt === "scoped_identifier" || pt === "scoped_type_identifier") && f === "name") return { kind: "path", receiver: child(t, p, "path"), expr: p };
    if (ty === "field_identifier" || ty === "shorthand_field_identifier") return { kind: "skip" };
    if (pt === "macro_invocation" || pt === "attribute" || pt === "meta_item") return { kind: "skip" };
    for (let x = p, k = 0; x >= 0 && k < 6; x = t.parent[x], k++) if (t.type[x] === "use_declaration" || t.type[x] === "attribute_item" || t.type[x] === "inner_attribute_item") return { kind: "skip" };
    if (ty === "identifier" && textOf(t, n) === "Self") return { kind: "skip" };
    return { kind: "bare", expr: n };
};

const isCallee = (t: Flat, e: number) => {
    // A macro token followed by `(`.
    if (t.type[t.parent[e]] === "token_tree") return opensCall(t, t.next[e]);
    let x = e;
    let p = t.parent[x];
    if (p >= 0 && t.type[p] === "generic_function" && t.field[x] === "function") {
        x = p;
        p = t.parent[x];
    }
    return p >= 0 && t.type[p] === "call_expression" && t.field[x] === "function";
};

/** An item with the attributes right above it: `#[inline]`, `#[derive(...)]`. */
const withAttributes = (t: Flat, n: number): number => {
    let outer = n;
    for (let p = previous(t, n); p >= 0 && t.type[p] === "attribute_item"; p = previous(t, p)) outer = p;
    return outer;
};

const unit: LangRules["unit"] = (t, capture, node) => {
    const ty = t.type[node];
    const outer = withAttributes(t, node);
    if ((capture === "definition.function" || capture === "definition.method") && ty === "function_item") return { kind: "function", nameNode: child(t, node, "name"), outer };
    if (capture === "definition.class" && (ty === "struct_item" || ty === "enum_item" || ty === "union_item" || ty === "type_item")) return { kind: "type", nameNode: child(t, node, "name"), outer };
    if (capture === "definition.interface" && ty === "trait_item") return { kind: "type", nameNode: child(t, node, "name"), outer };
    if (capture === "definition.module" && ty === "mod_item" && child(t, node, "body") >= 0) return { kind: "namespace", nameNode: child(t, node, "name"), outer };
    return null;
};

/** The name token of the type an impl implements. */
const implName = (t: Flat, n: number): number => {
    let x = child(t, n, "type");
    while (x >= 0 && (t.type[x] === "generic_type" || t.type[x] === "reference_type")) x = child(t, x, "type");
    if (x >= 0 && t.type[x] === "scoped_type_identifier") x = child(t, x, "name");
    return x >= 0 && t.type[x] === "type_identifier" ? x : -1;
};

/** The last segment of a trait's path, without its generic arguments: `fmt::Display` is Display. */
const traitName = (t: Flat, n: number): string => {
    let x = n;
    while (x >= 0 && t.type[x] === "generic_type") x = child(t, x, "type");
    if (x >= 0 && t.type[x] === "scoped_type_identifier") x = child(t, x, "name");
    return x >= 0 ? textOf(t, x) : "";
};

export const RUST_RULES: LangRules = {
    unit,
    extraUnits: (t) => {
        const out: { kind: "class"; nameNode: number; outer: number; node: number }[] = [];
        for (let n = 0; n < t.count; n++) {
            if (t.type[n] !== "impl_item") continue;
            const name = implName(t, n);
            if (name >= 0) out.push({ kind: "class", nameNode: name, outer: withAttributes(t, n), node: n });
        }
        return out;
    },
    label: (t, u, parent) => {
        if (t.type[u.node] === "impl_item") {
            const trait = child(t, u.node, "trait");
            return trait >= 0 ? `impl ${traitName(t, trait)} for ${u.name}` : `impl ${u.name}`;
        }
        return labelOf({ name: u.name, kind: u.kind, ...(parent ? { parent: parent.name } : {}) }, RUST.id);
    },
    scope: (t, n) => {
        switch (t.type[n]) {
            case "function_item":
            case "closure_expression":
                return "function";
            case "impl_item":
            case "trait_item":
                return "class";
            case "mod_item":
                return child(t, n, "body") >= 0 ? "module" : null;
            case "block":
            case "match_arm":
            case "for_expression":
            case "if_expression":
            case "while_expression":
            case "loop_expression":
                return "block";
            // An item's generic parameters are its own.
            case "struct_item":
            case "enum_item":
            case "union_item":
            case "type_item":
            case "function_signature_item":
                return child(t, n, "type_parameters") >= 0 ? "block" : null;
            default:
                return null;
        }
    },
    binds,
    identifiers: new Set(["identifier", "type_identifier", "field_identifier"]),
    role,
    isCallee,
    isType: (t, n) => t.type[n] === "type_identifier",
    imports,
    classOf: (t, n) => {
        const ty = t.type[n];
        return ty === "impl_item" || ty === "trait_item" || ty === "struct_item" || ty === "enum_item" || ty === "union_item" ? { bases: [] } : null;
    },
};
