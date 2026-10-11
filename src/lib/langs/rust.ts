/**
 * Rust's rule table: tree-sitter-rust 0.24.0's nodes, its own `tags.scm` for
 * the units (structs, enums, traits, functions, methods, inline modules) plus
 * impl blocks, and Rust's scoping: the items of a module, blocks, closures,
 * `let`, `if let`, `match` and `for` patterns, each local seen from the end
 * of its statement. A declaration's own name is no use, an associated item's
 * and an enum variant's too. An impl's methods are not seen as bare names
 * inside it (`Self::f`, `self.f`), and `self` and `Self` mean the impl around
 * them, none for an impl inside a function; an inline `mod` sees its parent
 * only through `use super::*`. A type's methods are its inherent impls'
 * (`impl T`), never a trait's: an inherent method wins, and a trait method may
 * be implemented anywhere. But `x.f()` probes x's type by value, then `&`,
 * then `&mut`, and a trait's `f` found at an earlier step wins: an inherent
 * method links only when no trait method of its name, in the files or the
 * standard library, takes `self` in a mode that comes first for x (`self`
 * in a `&self` method is a `&` reference, in a `&mut self` one a `&mut`;
 * any other receiver may be either, or a value). In the standard library's
 * expression macros (`format!`, `assert_eq!`, ...) only calls count, of names
 * the macro's own tokens don't bind, nested ones included; other macros'
 * tokens prove nothing.
 * Paths into other files (`crate::`, `super::`, other crates) need the
 * crate's `mod` tree, which isn't read: they name nothing.
 */

import type { Emit, GFile, GImport, LangRules, Role } from "../anyfacts.ts";
import type { Hint, Resolver, Typing, TypeName } from "../anylink.ts";
import { labelOf } from "../symbols.ts";
import { child, namedChildren, textOf, type Flat } from "../syntax.ts";

/** Macros whose arguments are ordinary expressions. */
const EXPRESSION_MACROS = new Set([
    "println", "print", "eprintln", "eprint", "format", "format_args", "write", "writeln", "panic", "assert", "assert_eq", "assert_ne",
    "debug_assert", "debug_assert_eq", "debug_assert_ne", "vec", "matches", "dbg", "todo", "unimplemented", "unreachable",
]);

/** The expression macro whose tokens hold an identifier, through nested token trees, or -1. */
const expressionMacro = (t: Flat, n: number): number => {
    let m = t.parent[n];
    while (m >= 0 && t.type[m] === "token_tree") m = t.parent[m];
    if (m < 0 || t.type[m] !== "macro_invocation") return -1;
    const name = child(t, m, "macro");
    return name >= 0 && EXPRESSION_MACROS.has(textOf(t, name)) ? m : -1;
};

const opensCall = (t: Flat, n: number) => n >= 0 && t.type[n] === "token_tree" && t.text[t.start[n]] === "(";

/** Tokens after which a `|` starts a closure: a tree's opening, a separator, an assignment or arrow, `&`, another closure, `move`, `return`. */
const CLOSURE_AFTER = new Set(["(", "[", "{", ",", ";", ":", "=", "=>", "&", "|", "move", "return"]);
const opensClosure = (t: Flat, prev: number) => prev < 0 || CLOSURE_AFTER.has(t.type[prev]) || (t.type[prev] === "identifier" && (textOf(t, prev) === "move" || textOf(t, prev) === "return"));

/**
 * The names a macro's tokens bind, which are no uses anywhere in them: a
 * closure's parameters (any name between two `|` of one token tree, so an
 * operand of `a | b` counts too), a `let` or `for` pattern, a `match` arm's
 * pattern, a named format argument (`path = p`), and everything `matches!`
 * matches against. A token tree inside a pattern is all pattern:
 * `|(_, v)|`, `if let Some(v) =`.
 */
const boundCache = new WeakMap<Flat, Map<number, Set<string>>>();
const macroBound = (t: Flat, macro: number): Set<string> => {
    let byMacro = boundCache.get(t);
    if (!byMacro) boundCache.set(t, (byMacro = new Map()));
    let hit = byMacro.get(macro);
    if (hit) return hit;
    const bound = (hit = new Set<string>());
    byMacro.set(macro, bound);
    // `matches!(e, Pattern if guard)`: what follows the first comma is a pattern, here or in a `matches!` among the tokens.
    // A `match`'s braces hold its arms: each arm's pattern runs to its `=>`, its body to a comma or past a braced block.
    const walk = (tree: number, mode: "expr" | "matches" | "pattern" | "arms") => {
        let pipes = 0;
        let binding = false;
        let commas = 0;
        let arm = mode === "arms";
        let armBody = false;
        let matchArms = false;
        for (let c = t.first[tree], prev = -1, prev2 = -1; c >= 0; prev2 = prev, prev = c, c = t.next[c]) {
            const ty = t.type[c];
            const inPattern = mode === "pattern" || (mode === "matches" && commas > 0) || pipes % 2 === 1 || binding || arm;
            if (ty === "token_tree") {
                const matches = prev >= 0 && t.type[prev] === "!" && prev2 >= 0 && t.type[prev2] === "identifier" && textOf(t, prev2) === "matches";
                const braces = t.text[t.start[c]] === "{";
                if (inPattern) walk(c, "pattern");
                else if (matchArms && braces) walk(c, "arms");
                else walk(c, matches ? "matches" : "expr");
                if (matchArms && braces) matchArms = false;
                // An arm whose body is a block ends with it.
                else if (armBody && braces && prev >= 0 && t.type[prev] === "=>") (armBody = false), (arm = true);
                continue;
            }
            // A `|` opens a closure's parameters only where a closure can start; else it is a bitwise or, unless it closes them.
            if (ty === "|" && (pipes % 2 === 1 || opensClosure(t, prev))) pipes++;
            else if (ty === ",") {
                commas++;
                if (mode === "arms" && armBody) (armBody = false), (arm = true);
            }
            if (ty === "let" || ty === "for") binding = true;
            else if (ty === "=" || ty === ";" || (ty === "identifier" && binding && textOf(t, c) === "in")) binding = false;
            if (ty === "match") matchArms = true;
            if (ty === "=>" && mode === "arms") (arm = false), (armBody = true);
            if (ty !== "identifier") continue;
            const next = t.next[c];
            const named = next >= 0 && t.type[next] === "=" && !(t.next[next] >= 0 && t.type[t.next[next]] === "=");
            if (inPattern || named) bound.add(textOf(t, c));
        }
    };
    const tokens = namedChildren(t, macro).find((c) => t.type[c] === "token_tree");
    if (tokens !== undefined) walk(tokens, textOf(t, child(t, macro, "macro")) === "matches" ? "matches" : "expr");
    return bound;
};

/** A token that ends a receiver: `self`, or an identifier no token before it joins to another (`a.b.f(` and `a::b.f(` aren't read). */
const loneReceiver = (t: Flat, n: number) => {
    if (n < 0 || !(t.type[n] === "self" || t.type[n] === "identifier")) return false;
    const before = previous(t, n);
    return !(before >= 0 && !t.named[before] && (t.type[before] === "." || t.type[before] === "::"));
};

/** Each node's previous sibling, or -1, once per tree: a macro's token tree can hold thousands of tokens. */
const prevCache = new WeakMap<Flat, Int32Array>();
const previous = (t: Flat, n: number): number => {
    let prev = prevCache.get(t);
    if (!prev) {
        prev = new Int32Array(t.count).fill(-1);
        for (let p = 0; p < t.count; p++) for (let c = t.first[p], last = -1; c >= 0; last = c, c = t.next[c]) prev[c] = last;
        prevCache.set(t, prev);
    }
    return prev[n];
};

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

const importCache = new WeakMap<Flat, GImport[]>();
const imports = (t: Flat) => {
    let hit = importCache.get(t);
    if (!hit) importCache.set(t, (hit = importsOf(t)));
    return hit;
};

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

export const RUST: LangRules = {
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
        return labelOf({ name: u.name, kind: u.kind, ...(parent ? { parent: parent.name } : {}) }, "rs");
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

/** How a method takes `self`: by value, `&self`, `&mut self`, or as another type (`self: Box<Self>`). */
type Mode = "value" | "ref" | "mut" | "other";

/** A function's receiver mode, or null when it takes no `self`. */
const modeOf = (t: Flat, fn: number): Mode | null => {
    for (const p of namedChildren(t, child(t, fn, "parameters"))) {
        if (t.type[p] === "self_parameter") {
            let ref = false;
            let mut = false;
            for (let c = t.first[p]; c >= 0; c = t.next[c]) {
                if (t.type[c] === "&") ref = true;
                else if (t.type[c] === "mutable_specifier") mut = true;
            }
            return ref ? (mut ? "mut" : "ref") : "value";
        }
        if (t.type[p] !== "parameter" || !namedChildren(t, p).some((c) => t.type[c] === "self")) continue;
        // `self: Self`, `self: &Self`, `self: &mut Self`; any other type (`Box<Self>`, `Pin<&mut Self>`) is another step of the probe.
        const type = child(t, p, "type");
        if (type >= 0 && textOf(t, type) === "Self") return "value";
        if (type >= 0 && t.type[type] === "reference_type" && textOf(t, child(t, type, "type")) === "Self") return namedChildren(t, type).some((c) => t.type[c] === "mutable_specifier") ? "mut" : "ref";
        return "other";
    }
    return null;
};

/**
 * The standard library's trait methods by how they take `self`. By value:
 * Into, IntoIterator, TryInto and IntoFuture, Iterator's adapters,
 * consumers and comparisons, Read's and BufRead's adapters, Ord's max, min
 * and clamp, the operator traits. `&mut self`: io's Write, Read, BufRead
 * and Seek, Iterator's and DoubleEndedIterator's stepping methods, Hasher,
 * fmt::Write, Extend, the `*Assign` operators, DerefMut, AsMut, BorrowMut,
 * IndexMut, Clone::clone_from. `&self`: Clone, ToString, ToOwned, Display
 * and Debug, PartialEq, PartialOrd, Ord::cmp, Hash, Deref, AsRef, Borrow,
 * Index, ExactSizeIterator, Error, Any, Hasher::finish.
 */
const STD_MODES: Record<"value" | "mut" | "ref", string> = {
    value:
        "into into_iter try_into into_future map filter filter_map flat_map flatten take skip take_while skip_while map_while step_by chain zip enumerate peekable rev cloned copied cycle fuse inspect scan count last sum product fold rfold reduce try_reduce for_each collect try_collect collect_into partition is_partitioned unzip max min max_by max_by_key min_by min_by_key clamp cmp partial_cmp eq ne lt le gt ge cmp_by partial_cmp_by eq_by is_sorted is_sorted_by is_sorted_by_key array_chunks map_windows intersperse intersperse_with bytes lines split add sub mul div rem neg not bitand bitor bitxor shl shr",
    mut: "write write_all write_vectored write_all_vectored write_fmt flush by_ref read read_vectored read_to_end read_to_string read_exact read_buf read_buf_exact fill_buf consume read_until read_line skip_until has_data_left seek rewind stream_position stream_len seek_relative next nth all any find find_map position rposition try_fold try_for_each try_find advance_by next_chunk next_back nth_back rfind try_rfold advance_back_by write_u8 write_u16 write_u32 write_u64 write_u128 write_usize write_i8 write_i16 write_i32 write_i64 write_i128 write_isize write_length_prefix write_str write_char extend extend_one extend_reserve add_assign sub_assign mul_assign div_assign rem_assign bitand_assign bitor_assign bitxor_assign shl_assign shr_assign deref_mut as_mut borrow_mut index_mut clone_from call_mut",
    ref: "clone to_string to_owned fmt eq ne partial_cmp lt le gt ge cmp hash deref as_ref borrow index size_hint len is_empty source description cause type_id finish build_hasher hash_one call provide",
};

/** The receiver modes trait methods give each name: the standard library's, and those of the traits and trait impls among the files. */
const traitModes = (files: readonly GFile[]): ReadonlyMap<string, ReadonlySet<string>> => {
    const out = new Map<string, Set<string>>();
    const add = (name: string, mode: Mode) => {
        const modes = out.get(name);
        if (modes) modes.add(mode);
        else out.set(name, new Set([mode]));
    };
    for (const [mode, names] of Object.entries(STD_MODES)) for (const name of names.split(" ")) add(name, mode as Mode);
    for (const f of files) {
        const t = f.flat;
        for (let n = 0; n < t.count; n++) {
            if (t.type[n] !== "function_item" && t.type[n] !== "function_signature_item") continue;
            const list = t.parent[n];
            const owner = list >= 0 && t.type[list] === "declaration_list" ? t.parent[list] : -1;
            if (owner < 0 || !(t.type[owner] === "trait_item" || (t.type[owner] === "impl_item" && child(t, owner, "trait") >= 0))) continue;
            const mode = modeOf(t, n);
            if (mode) add(textOf(t, child(t, n, "name")), mode);
        }
    }
    return out;
};

/**
 * For a receiver of a mode, or any (a value, `&` or `&mut`), and an
 * inherent method of a mode: the trait modes the probe tries first. It tries
 * the receiver's type by value, then `&`, then `&mut`, then the same after
 * each deref, an inherent method before a trait's at each step. A receiver
 * that is another type (`Box<Self>`, `&&T`) meets traits implemented for that
 * type before x's own methods: any mode comes first.
 */
const ALL: readonly Mode[] = ["value", "ref", "mut"];
const FIRST: Record<"value" | "ref" | "mut" | "any" | "other", Record<"value" | "ref" | "mut", readonly Mode[]>> = {
    value: { value: [], ref: ["value"], mut: ["value", "ref"] },
    ref: { value: ["ref"], ref: [], mut: ["ref", "value"] },
    mut: { value: ["mut"], ref: ["mut", "value"], mut: [] },
    any: { value: ["ref", "mut"], ref: ["value", "mut"], mut: ["value", "ref"] },
    other: { value: ALL, ref: ALL, mut: ALL },
};

/** The receiver mode a declared type gives: `&T`, `&mut T`, `T`; two `&`s or a raw pointer are another type; anything else may be any. */
const typeMode = (t: Flat, type: number): keyof typeof FIRST => {
    switch (t.type[type]) {
        case "reference_type": {
            const inner = child(t, type, "type");
            if (inner >= 0 && t.type[inner] === "reference_type") return "other";
            return namedChildren(t, type).some((c) => t.type[c] === "mutable_specifier") ? "mut" : "ref";
        }
        case "type_identifier":
        case "scoped_type_identifier":
        case "generic_type":
            return "value";
        case "pointer_type":
            return "other";
        default:
            return "any";
    }
};

/** What a receiver is: `self` in the method it's written in takes that method's mode, a name its declared type's; any other may be any. */
const receiverKind = (t: Flat, n: number, declared: number): keyof typeof FIRST => {
    if (n >= 0 && (t.type[n] === "self" || (t.type[n] === "identifier" && textOf(t, n) === "self"))) {
        let fn = t.parent[n];
        while (fn >= 0 && t.type[fn] !== "function_item") fn = t.parent[fn];
        return (fn >= 0 ? modeOf(t, fn) : null) ?? "any";
    }
    return declared >= 0 ? typeMode(t, declared) : "any";
};

/** The impl, trait or type a node sits in, whose `self` and `Self` it means, or -1. */
const selfClass = (t: Flat, n: number): number => {
    for (let x = t.parent[n]; x >= 0; x = t.parent[x]) {
        const ty = t.type[x];
        if (ty === "impl_item" || ty === "trait_item" || ty === "struct_item" || ty === "enum_item" || ty === "union_item") return x;
    }
    return -1;
};

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
    // A trait method of the name whose mode the probe tries first wins; one taking `self` as another type might.
    shadowed: (call, receiver, declared, method, unitNode, modes) => {
        const mode = modeOf(method, unitNode);
        if (mode === null) return false;
        if (mode === "other" || modes.has("other")) return modes.size > 0;
        return FIRST[receiverKind(call, receiver, declared)][mode].some((m) => modes.has(m));
    },
};

export const RUST_RESOLVER: Resolver = { typing: RUST_TYPING, moduleFiles: () => [] };
