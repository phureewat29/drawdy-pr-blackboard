/** C#'s syntax nodes as the rule table and the resolver read them: tree-sitter-c-sharp 0.23.5's. */

import { child, hasToken, namedChildren, perTree, textOf, type Flat } from "../../syntax.ts";

/**
 * An identifier as C# compares it (C# spec 6.4.3): `@` dropped, each
 * `\u` escape read, formatting characters removed. `@value` is `value`.
 */
export const bare = (name: string): string => {
    const s = name.startsWith("@") ? name.slice(1) : name;
    return /[\\\p{Cf}]/u.test(s) ? s.replace(/\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})/g, (_, a: string, b: string) => String.fromCodePoint(parseInt(a ?? b, 16))).replace(/\p{Cf}/gu, "") : s;
};

/** A node's named children but comments, which tree-sitter puts wherever they're written. */
export const code = (t: Flat, n: number): number[] => (n < 0 ? [] : namedChildren(t, n).filter((c) => t.type[c] !== "comment"));

export const TYPE_KINDS = { class_declaration: "class", struct_declaration: "struct", record_declaration: "record", interface_declaration: "interface", enum_declaration: "enum" } as const;
export type TypeKind = (typeof TYPE_KINDS)[keyof typeof TYPE_KINDS];
export const TYPE_DECLARATIONS: ReadonlySet<string> = new Set(Object.keys(TYPE_KINDS));

/** `#if`, `#elif` and `#else`: what they hold is compiled in some builds only. */
const CONDITIONAL: ReadonlySet<string> = new Set(["preproc_if", "preproc_elif", "preproc_else", "preproc_if_in_attribute_list"]);

/** The node a node sits in, past any `#if` around it. */
export const holder = (t: Flat, n: number): number => {
    let p = t.parent[n];
    while (p >= 0 && CONDITIONAL.has(t.type[p])) p = t.parent[p];
    return p;
};

const conditionals = perTree((t: Flat): Uint8Array => {
    const inside = new Uint8Array(t.count);
    for (let n = 1; n < t.count; n++) inside[n] = inside[t.parent[n]] || (CONDITIONAL.has(t.type[t.parent[n]]) ? 1 : 0);
    return inside;
});

/** Whether a node is compiled in some builds only: inside `#if`, `#elif` or `#else`. */
export const conditional = (t: Flat, n: number): boolean => n > 0 && conditionals(t)[n] === 1;

const DIRECTIVES: ReadonlySet<string> = new Set(["#if", "#elif", "#else", "#endif"]);

/** The conditional directives' tokens, in order: where each starts and where its line ends. */
const directives = perTree((t: Flat): { at: number; kind: string; end: number }[] => {
    const out: { at: number; kind: string; end: number }[] = [];
    for (let n = 0; n < t.count; n++) {
        if (t.named[n] || !DIRECTIVES.has(t.type[n])) continue;
        const nl = t.text.indexOf("\n", t.start[n]);
        out.push({ at: t.start[n], kind: t.type[n], end: nl < 0 ? t.text.length : nl });
    }
    return out.sort((a, b) => a.at - b.at);
});

/** Whether a node holds a conditional directive: what it is depends on the build. */
export const holdsDirective = (t: Flat, n: number): boolean => {
    const ds = directives(t);
    if (n < 0 || ds.length === 0) return false;
    let lo = 0;
    let hi = ds.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (ds[mid].at < t.start[n]) lo = mid + 1;
        else hi = mid;
    }
    return lo < ds.length && ds[lo].at < t.end[n];
};

const OPENS: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
const CLOSES: ReadonlySet<string> = new Set(["}", ")", "]"]);

/**
 * Whether each branch of every `#if` balances its brackets, and every
 * directive line of the text is one the tree shows. tree-sitter reads all
 * branches at once, so a branch that opens what another closes (`#if A`
 * `if (x) {` `#else` `if (y) {` `#endif`) moves the code after it.
 */
const branchesBalance = (t: Flat): boolean => {
    const ds = directives(t);
    const lines = [...t.text.matchAll(/^[ \t]*#[ \t]*(?:if|elif|else|endif)\b/gm)].map((m) => m.index + m[0].indexOf("#"));
    if (lines.length === 0 && ds.length === 0) return true;
    // A directive line the tree doesn't show must be inside a string or a comment.
    const at = new Set(ds.map((d) => d.at));
    const unseen = lines.filter((x) => !at.has(x));
    if (unseen.length > 0) {
        const quoted: [number, number][] = [];
        for (let n = 0; n < t.count; n++) if (/string|comment|character_literal/.test(t.type[n])) quoted.push([t.start[n], t.end[n]]);
        if (unseen.some((x) => !quoted.some(([s, e]) => s <= x && x < e))) return false;
    }
    // Each branch: from the end of its directive's line to the next directive of its `#if`.
    const branches: { start: number; end: number }[] = [];
    const open: number[] = [];
    for (const d of ds) {
        if (d.kind === "#if") open.push(d.end);
        else {
            const from = open.pop();
            if (from === undefined) return false;
            branches.push({ start: from, end: d.at });
            if (d.kind !== "#endif") open.push(d.end);
        }
    }
    if (open.length > 0) return false;
    branches.sort((a, b) => a.start - b.start || b.end - a.end);
    // Each bracket written (not one tree-sitter supplied, nor one of a directive's line) goes to its innermost branch.
    const seqs = new Map<number, string[]>();
    const stack: number[] = [];
    let next = 0;
    let line = 0;
    for (let n = 0; n < t.count; n++) {
        const ty = t.type[n];
        if (t.first[n] >= 0 || t.start[n] === t.end[n] || !(ty in OPENS || CLOSES.has(ty))) continue;
        const x = t.start[n];
        while (line < ds.length && ds[line].end <= x) line++;
        if (line < ds.length && ds[line].at <= x) continue;
        while (next < branches.length && branches[next].start <= x) {
            while (stack.length > 0 && branches[stack[stack.length - 1]].end <= branches[next].start) stack.pop();
            stack.push(next++);
        }
        while (stack.length > 0 && branches[stack[stack.length - 1]].end <= x) stack.pop();
        if (stack.length === 0) continue;
        const k = stack[stack.length - 1];
        const seq = seqs.get(k) ?? [];
        seq.push(ty);
        seqs.set(k, seq);
    }
    for (const seq of seqs.values()) {
        const want: string[] = [];
        for (const ty of seq) if (ty in OPENS) want.push(OPENS[ty]);
        else if (want.pop() !== ty) return false;
        if (want.length > 0) return false;
    }
    return true;
};

/** Whether a declaration expression sits where C# allows one: after `out`, or in a tuple a deconstruction writes to. */
const declarationFits = (t: Flat, n: number): boolean => {
    const arg = t.parent[n];
    if (t.type[arg] !== "argument") return true;
    const list = t.parent[arg];
    if (t.type[list] !== "tuple_expression") return hasToken(t, arg, "out");
    let top = list;
    while (t.type[t.parent[top]] === "argument" && t.type[t.parent[t.parent[top]]] === "tuple_expression") top = t.parent[t.parent[top]];
    const p = t.parent[top];
    return (t.type[p] === "assignment_expression" || t.type[p] === "foreach_statement") && t.field[top] === "left";
};

const operator = (t: Flat, n: number): string => {
    const o = child(t, n, "operator");
    return o >= 0 ? t.type[o] : "";
};

const NAMED_BY: ReadonlySet<string> = new Set(["member_access_expression", "member_binding_expression", "qualified_name", "alias_qualified_name"]);

/** The expression a generic name ends: itself, or the member access whose last name it is (`this.a<b, c>`, `x?.a<b, c>`). */
const ending = (t: Flat, n: number): number => {
    for (let p = t.parent[n]; p >= 0; n = p, p = t.parent[p]) {
        const ty = t.type[p];
        if (ty === "conditional_access_expression" ? t.field[n] === "condition" : !NAMED_BY.has(ty) || t.field[n] !== "name") break;
    }
    return n;
};

/**
 * Whether a node is what an operator applies to: never a name ending in a
 * generic one in C# (`F(a < b, c > -1)` is two comparisons, C# spec
 * 6.2.5), a type after `is` or `as` aside.
 */
const operand = (t: Flat, n: number): boolean => {
    switch (t.type[t.parent[n]]) {
        case "binary_expression":
        case "prefix_unary_expression":
        case "postfix_unary_expression":
        case "conditional_expression":
            return true;
        case "is_expression":
        case "as_expression":
            return t.field[n] === "left";
        case "is_pattern_expression":
            return t.field[n] === "expression";
        default:
            return false;
    }
};

/** Type nodes that read as an expression too: `(x) - y` is a cast only where they don't (C# spec 12.9.7). */
const NAME_TYPES: ReadonlySet<string> = new Set(["identifier", "generic_name", "qualified_name", "alias_qualified_name"]);

/** Whether a cast is one C# reads: its type is no expression, or what follows `)` is `~`, `!`, `(`, a name, a literal or a keyword. */
const castFits = (t: Flat, n: number): boolean => {
    if (!NAME_TYPES.has(t.type[child(t, n, "type")])) return true;
    const value = child(t, n, "value");
    return value >= 0 && /^[\p{L}\p{Nd}_@"'(~!]/u.test(textOf(t, value));
};

/**
 * Why tree-sitter's reading of a file may not be the compiler's, or null.
 * A parse error (an ERROR or MISSING node); an `#if` branch that doesn't
 * balance its brackets; a shape C# can't mean, which tree-sitter makes of
 * `F(a * b)` (a declaration `a* b`), `F(a < b, c > d)` and
 * `Get<(int a, int b)>(x)` (declarations; `Get < (…) > (x)` a chain of
 * comparisons), `(a) - b` and `(a) && (b)` (casts), `F(async);` (a
 * declaration `F (async)`), `x is A.B` (`(x is A).B`); or a C# 14
 * `extension(…)` block, read as a constructor. A doubtful file declares
 * nothing and draws nothing.
 */
export const doubtOf = perTree((t: Flat): string | null => {
    if (t.errors > 0) return "a parse error";
    if (!branchesBalance(t)) return "an #if branch that doesn't balance";
    for (let n = 0; n < t.count; n++) {
        const ty = t.type[n];
        if (ty === "declaration_expression" && !declarationFits(t, n)) return "a declaration where C# allows none";
        if (ty === "binary_expression" && [">", ">=", ">>", ">>>", "<"].includes(operator(t, n)) && t.type[child(t, n, "left")] === "binary_expression" && operator(t, child(t, n, "left")) === "<") return "a generic read as comparisons";
        if (ty === "object_creation_expression" && argumentList(t, n) < 0 && !code(t, n).some((c) => t.type[c] === "initializer_expression")) return "a generic read as comparisons";
        if (ty === "predefined_type" && t.type[t.parent[n]] === "argument") return "a type read as an argument";
        if (ty === "assignment_expression" && t.type[child(t, n, "left")] === "generic_name") return "a generic read as an assignment";
        if (ty === "generic_name" && operand(t, ending(t, n))) return "a generic read as comparisons";
        // `F(a < b, c > x => x)`: a return type needs parameters in parentheses (C# spec 12.19.1).
        if (ty === "lambda_expression" && child(t, n, "type") >= 0 && t.type[child(t, n, "parameters")] === "implicit_parameter") return "a comparison read as a lambda";
        if (ty === "cast_expression" && !castFits(t, n)) return "an expression read as a cast";
        if (ty === "member_access_expression" && !PRIMARY.has(t.type[child(t, n, "expression")]) && !["predefined_type", "qualified_name", "alias_qualified_name"].includes(t.type[child(t, n, "expression")])) return "an operator read into a member access";
        if (ty === "variable_declarator" && t.type[t.parent[n]] === "variable_declaration" && code(t, n).some((c) => t.type[c] === "tuple_pattern") && !isVar(t, child(t, t.parent[n], "type"))) return "a call read as a declaration";
        if (ty === "constructor_declaration" && textOf(t, child(t, n, "name")) === "extension") {
            const owner = holder(t, holder(t, n));
            if (owner >= 0 && textOf(t, child(t, owner, "name")) !== "extension") return "an extension block";
        }
    }
    return null;
});

/** Whether a declaration is a top-level type, a namespace's, or a member of such a type: a card can stand for it. */
export const isMember = (t: Flat, n: number): boolean => {
    const p = holder(t, n);
    if (p < 0) return false;
    if (t.type[p] === "compilation_unit") return true;
    if (t.type[p] !== "declaration_list") return false;
    const owner = holder(t, p);
    if (owner < 0) return false;
    if (t.type[owner] === "namespace_declaration") return true;
    return TYPE_DECLARATIONS.has(t.type[owner]) && t.type[owner] !== "enum_declaration" && isMember(t, owner);
};

/** A declaration's modifiers, as written. */
export const modifiers = (t: Flat, decl: number): string[] => code(t, decl).flatMap((c) => (t.type[c] === "modifier" ? [textOf(t, c)] : []));

export const hasModifier = (t: Flat, decl: number, word: string): boolean => modifiers(t, decl).includes(word);

/** Whether a declaration's header (all but its body) holds an `#if`: some builds write it otherwise. */
export const headerIf = (t: Flat, decl: number): boolean => {
    for (let c = t.first[decl]; c >= 0; c = t.next[c]) if (t.field[c] !== "body" && (CONDITIONAL.has(t.type[c]) || holdsDirective(t, c))) return true;
    return false;
};

/** A dotted name's parts: `A.B.C` gives [A, B, C]; a generic part's name alone. */
export const dotted = (t: Flat, n: number): string[] => {
    if (n < 0) return [];
    switch (t.type[n]) {
        case "qualified_name":
            return [...dotted(t, child(t, n, "qualifier")), ...dotted(t, child(t, n, "name"))];
        case "generic_name":
            return dotted(t, code(t, n)[0] ?? -1);
        default:
            return [bare(textOf(t, n))];
    }
};

/** A generic name's type arguments, or []. */
export const typeArgs = (t: Flat, n: number): number[] => (t.type[n] === "generic_name" ? code(t, code(t, n).find((c) => t.type[c] === "type_argument_list") ?? -1) : []);

/** How many type arguments a name takes: `Foo<int>` one, the unbound `Foo<,>` two. */
export const arityOf = (t: Flat, n: number): number => {
    if (t.type[n] !== "generic_name") return 0;
    const list = code(t, n).find((c) => t.type[c] === "type_argument_list") ?? -1;
    if (list < 0) return 0;
    let commas = 0;
    let depth = 0;
    for (const ch of textOf(t, list)) {
        if (ch === "<" || ch === "(" || ch === "[") depth++;
        else if (ch === ">" || ch === ")" || ch === "]") depth--;
        else if (ch === "," && depth === 1) commas++;
    }
    return Math.max(typeArgs(t, n).length, commas + 1);
};

/** A type declaration's or a method's type parameters' names. */
export const typeParams = (t: Flat, decl: number): string[] => {
    const list = child(t, decl, "type_parameters") >= 0 ? child(t, decl, "type_parameters") : (code(t, decl).find((c) => t.type[c] === "type_parameter_list") ?? -1);
    return code(t, list).map((p) => bare(textOf(t, child(t, p, "name"))));
};

/**
 * A parameter, as overload resolution reads it: how an argument is passed
 * (`ref readonly` its own way), whether it may be left out (a default
 * value or `[Optional]`), whether it takes the arguments left (`params`),
 * and `__arglist`, which takes any.
 */
export type Param = { name: string; type: number; mode: "" | "ref" | "out" | "in" | "ref readonly"; optional: boolean; params: boolean; arglist: boolean };

const modeOf = (mods: readonly string[]): Param["mode"] => (mods.includes("out") ? "out" : mods.includes("ref") ? (mods.includes("readonly") ? "ref readonly" : "ref") : mods.includes("in") ? "in" : "");

/** A parameter list's parameters, a `params` one included (tree-sitter writes its type and name straight in the list). */
export const paramsOf = (t: Flat, list: number): Param[] => {
    const out: Param[] = [];
    if (list < 0) return out;
    for (let c = t.first[list]; c >= 0; c = t.next[c]) {
        if (t.type[c] === "parameter") {
            const mods = code(t, c).filter((m) => t.type[m] === "modifier").map((m) => textOf(t, m));
            const value = code(t, c).find((x) => t.field[x] === "" && t.type[x] !== "modifier" && t.type[x] !== "attribute_list");
            const attrs = code(t, c).filter((x) => t.type[x] === "attribute_list").map((x) => textOf(t, x));
            const name = bare(textOf(t, child(t, c, "name")));
            out.push({ name, type: child(t, c, "type"), mode: modeOf(mods), optional: value !== undefined || attrs.some((a) => /\bOptional(Attribute)?\b/.test(a)), params: false, arglist: name === "__arglist" });
        } else if (t.field[c] === "name") {
            let ty = -1;
            for (let x = t.first[list]; x >= 0 && x !== c; x = t.next[x]) if (t.field[x] === "type") ty = x;
            out.push({ name: bare(textOf(t, c)), type: ty, mode: "", optional: false, params: true, arglist: false });
        }
    }
    return out;
};

/** A method's, a constructor's or a delegate's parameter list. */
export const parameterList = (t: Flat, decl: number): number => (child(t, decl, "parameters") >= 0 ? child(t, decl, "parameters") : (code(t, decl).find((c) => t.type[c] === "parameter_list") ?? -1));

/** Expressions that may start a `?.` chain: any other there is tree-sitter's misreading (`(T)x?.y`, `a == b?.c`), whose `?.` belongs to a part of it. */
const PRIMARY: ReadonlySet<string> = new Set([
    "identifier", "this", "base", "generic_name", "member_access_expression", "invocation_expression", "element_access_expression", "conditional_access_expression", "parenthesized_expression",
    "object_creation_expression", "implicit_object_creation_expression", "array_creation_expression", "implicit_array_creation_expression", "anonymous_object_creation_expression", "tuple_expression",
    "typeof_expression", "sizeof_expression", "default_expression", "checked_expression",
    "postfix_unary_expression", "string_literal", "verbatim_string_literal", "raw_string_literal", "interpolated_string_expression", "character_literal", "integer_literal", "real_literal", "boolean_literal",
]);

/** The receiver of a `?.` access: the conditional access's condition, where C# reads it so; else -1. */
export const conditionOf = (t: Flat, access: number): number => {
    const c = child(t, access, "condition");
    return c >= 0 && PRIMARY.has(t.type[c]) ? c : -1;
};

/** Whether an expression binds at least as tightly as a unary one: an operator's left operand that tree-sitter didn't take from a looser one (`a ?? b as T`). */
export const tight = (t: Flat, n: number): boolean => PRIMARY.has(t.type[n]) || ["prefix_unary_expression", "cast_expression", "await_expression", "null_literal", "predefined_type"].includes(t.type[n]);

/** Whether a pattern may hold operators that follow it (`x is null && y`, `x is < 0 ? a : b`): tree-sitter's patterns take them in. */
export const swallows = (t: Flat, pattern: number): boolean => {
    for (let n = pattern + 1; n < t.count && t.start[n] < t.end[pattern]; n++) if (["binary_expression", "conditional_expression", "assignment_expression", "lambda_expression", "conditional_access_expression", "query_expression", "switch_expression"].includes(t.type[n])) return true;
    return false;
};

/** A variable declarator's value, or -1. */
export const valueOf = (t: Flat, declarator: number): number => code(t, declarator).find((c) => t.field[c] === "" && t.type[c] !== "bracketed_argument_list" && t.type[c] !== "tuple_pattern") ?? -1;

/** `var`: a type to infer, never one written. */
export const isVar = (t: Flat, type: number): boolean => type >= 0 && (t.type[type] === "implicit_type" || (t.type[type] === "identifier" && textOf(t, type) === "var"));

/** An argument's expression, its modifier (`ref`, `out`, `in`) and its name, if named. */
export type Arg = { expr: number; mod: string; name: string | null };

export const argsOf = (t: Flat, list: number): Arg[] =>
    code(t, list)
        .filter((a) => t.type[a] === "argument")
        .map((a) => {
            const name = child(t, a, "name");
            const expr = code(t, a).filter((c) => c !== name).pop() ?? -1;
            const mod = ["ref", "out", "in"].find((m) => hasToken(t, a, m)) ?? "";
            return { expr, mod, name: name >= 0 ? bare(textOf(t, name)) : null };
        });

/** The argument list of a call, a creation or a constructor initializer. */
export const argumentList = (t: Flat, n: number): number => (child(t, n, "arguments") >= 0 ? child(t, n, "arguments") : (code(t, n).find((c) => t.type[c] === "argument_list") ?? -1));
