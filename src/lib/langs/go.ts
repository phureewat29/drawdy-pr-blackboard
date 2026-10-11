/**
 * Go's rule table: tree-sitter-go 0.25.0's nodes, its own `tags.scm` for the
 * units (functions, methods, types), and Go's scoping: a package is the files
 * of one folder with one package clause, every top-level name is the
 * package's and unique in it, a `_test.go` file's names are seen only by
 * tests, imports belong to a file, blocks, `if`, `for`, `switch` and
 * `select` open scopes, and a generic type's or a method receiver's type
 * parameters are their own. Methods belong to their receiver's type by name
 * within the package. A declaration links only from code whose build always
 * holds its file (GOOS and GOARCH suffixes, `//go:build` lines). An import
 * path names a folder of the same module through go.mod's module line, read
 * for its package clause, which names it; `T(v)` uses T.
 */

import type { Emit, GImport, LangRules, Role } from "../anyfacts.ts";
import type { Field, Hint, ModuleContext, Resolver, Typing, TypeName } from "../anylink.ts";
import { labelOf } from "../symbols.ts";
import { child, hasToken, namedChildren, textOf, type Flat } from "../syntax.ts";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The names an import path's package may go by when no alias is given: `yaml.v3` is yaml, `go-isatty` is isatty, `v2` is its parent. */
const packageNames = (path: string): string[] => {
    const segs = path.split("/");
    let last = segs[segs.length - 1] ?? "";
    if (/^v[0-9]+$/.test(last) && segs.length > 1) last = segs[segs.length - 2];
    const out = new Set<string>([last, last.split(".")[0], last.replace(/^go[-_]/, ""), last.replace(/[-_.]go$/, ""), last.replace(/[-.]/g, ""), last.replace(/[-.]/g, "_")]);
    return [...out].filter((n) => IDENT.test(n));
};

const importsOf = (t: Flat): GImport[] => {
    const out: GImport[] = [];
    for (let n = 0; n < t.count; n++) {
        if (t.type[n] !== "import_spec") continue;
        const pathNode = child(t, n, "path");
        const spec = textOf(t, pathNode).replace(/^["`]|["`]$/g, "");
        const name = child(t, n, "name");
        if (name >= 0 && t.type[name] === "dot") out.push({ local: "", spec, level: 0, name: "*", node: -1, bind: -1, stmt: n });
        else if (name >= 0 && t.type[name] === "blank_identifier") continue;
        else if (name >= 0) out.push({ local: textOf(t, name), spec, level: 0, name: null, node: -1, bind: name, stmt: n });
        // No name written: the package's own name binds, which only its files tell; these are guesses for them to confirm.
        else for (const local of packageNames(spec)) out.push({ local, spec, level: 0, name: null, node: -1, bind: pathNode, stmt: n, implicit: true });
    }
    return out;
};

const importCache = new WeakMap<Flat, GImport[]>();
const imports = (t: Flat) => {
    let hit = importCache.get(t);
    if (!hit) importCache.set(t, (hit = importsOf(t)));
    return hit;
};

const idsOf = (t: Flat, list: number): number[] => (list < 0 ? [] : t.type[list] === "identifier" ? [list] : namedChildren(t, list).filter((c) => t.type[c] === "identifier"));

/** A parameter list's names, each with its type. */
const params = (t: Flat, list: number, emit: Emit) => {
    for (const p of namedChildren(t, list)) {
        if (t.type[p] !== "parameter_declaration" && t.type[p] !== "variadic_parameter_declaration") continue;
        const type = child(t, p, "type");
        for (let c = t.first[p]; c >= 0; c = t.next[c]) if (t.field[c] === "name" && t.type[c] === "identifier") emit(c, "param", t.type[p] === "parameter_declaration" ? { typeNode: type } : {});
    }
};

/** `left := right`: each name with its own value, or the call's result in order, seen from the end of the statement on. */
const shortVars = (t: Flat, left: number, right: number, from: number, emit: Emit) => {
    const names = idsOf(t, left);
    const values = right < 0 ? [] : t.type[right] === "expression_list" ? namedChildren(t, right) : [right];
    names.forEach((id, i) => {
        if (values.length === names.length) emit(id, "local", { init: values[i], from });
        else if (values.length === 1) emit(id, "local", { init: values[0], initResult: i, from });
        else emit(id, "local", { from });
    });
};

const binds = (t: Flat, n: number, emit: Emit) => {
    switch (t.type[n]) {
        case "function_declaration":
            emit(child(t, n, "name"), "def", { unitNode: n });
            params(t, child(t, n, "parameters"), emit);
            params(t, child(t, n, "result"), emit);
            return;
        case "method_declaration": {
            params(t, child(t, n, "receiver"), emit);
            // `func (l *List[T]) Each(v T)`: the receiver's type arguments declare the method's type parameters.
            let recv = receiverType(t, n);
            while (recv >= 0 && (t.type[recv] === "pointer_type" || t.type[recv] === "parenthesized_type")) recv = namedChildren(t, recv)[0] ?? -1;
            if (recv >= 0 && t.type[recv] === "generic_type") {
                for (const arg of namedChildren(t, child(t, recv, "type_arguments"))) {
                    const id = t.type[arg] === "type_elem" ? namedChildren(t, arg)[0] : arg;
                    if (id !== undefined && t.type[id] === "type_identifier") emit(id, "param");
                }
            }
            params(t, child(t, n, "parameters"), emit);
            params(t, child(t, n, "result"), emit);
            return;
        }
        case "func_literal":
            params(t, child(t, n, "parameters"), emit);
            params(t, child(t, n, "result"), emit);
            return;
        case "type_parameter_declaration":
            for (const c of namedChildren(t, n)) if (t.field[c] === "name" || t.type[c] === "identifier") emit(c, "param");
            return;
        case "type_spec":
        case "type_alias":
            emit(child(t, n, "name"), "type", { unitNode: n });
            return;
        // A local is seen from the end of its statement on: before it, and in its own value, the name means the one outside.
        case "var_spec":
        case "const_spec": {
            const names: number[] = [];
            for (let c = t.first[n]; c >= 0; c = t.next[c]) if (t.field[c] === "name") names.push(c);
            const type = child(t, n, "type");
            const value = child(t, n, "value");
            const values = value < 0 ? [] : namedChildren(t, value);
            names.forEach((id, i) => emit(id, "local", { typeNode: type, from: t.end[n], ...(values.length === names.length ? { init: values[i] } : values.length === 1 ? { init: values[0], initResult: i } : {}) }));
            return;
        }
        case "short_var_declaration":
            shortVars(t, child(t, n, "left"), child(t, n, "right"), t.end[n], emit);
            return;
        case "range_clause":
        case "receive_statement":
            if (hasToken(t, n, ":=")) for (const id of idsOf(t, child(t, n, "left"))) emit(id, "local", { from: t.end[n] });
            return;
        case "type_switch_statement": {
            const value = child(t, n, "value");
            for (const id of idsOf(t, child(t, n, "alias"))) emit(id, "local", value >= 0 ? { from: t.end[value] } : {});
            return;
        }
        case "import_spec":
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
    if (pt === "selector_expression" && f === "field") return { kind: "member", receiver: child(t, p, "operand"), expr: p };
    if (pt === "qualified_type" && f === "name") return { kind: "member", receiver: child(t, p, "package"), expr: p };
    if (ty === "field_identifier") return { kind: "skip" };
    // A struct literal's keys name fields, not package-level declarations.
    if (pt === "literal_element" && t.field[p] === "key") return { kind: "skip" };
    if (pt === "method_declaration" && f === "name") return { kind: "decl" };
    // A parameter's name declares it, in a function type or an interface's method too, where no scope binds it.
    if ((pt === "parameter_declaration" || pt === "variadic_parameter_declaration") && f === "name") return { kind: "decl" };
    if (pt === "package_clause") return { kind: "skip" };
    if (ty === "identifier" && textOf(t, n) === "_") return { kind: "skip" };
    return { kind: "bare", expr: n };
};

const isCallee = (t: Flat, e: number) => {
    const p = t.parent[e];
    return p >= 0 && t.type[p] === "call_expression" && t.field[e] === "function";
};

const TYPE_PARENTS = new Set(["pointer_type", "qualified_type", "slice_type", "array_type", "map_type", "channel_type", "generic_type", "type_arguments", "parameter_declaration", "field_declaration", "type_spec", "type_alias", "composite_literal", "var_spec", "type_case", "type_assertion_expression", "type_conversion_expression"]);
const isType = (t: Flat, n: number) => t.type[n] === "type_identifier" || (t.type[n] === "package_identifier" && t.type[t.parent[n]] === "qualified_type") || (TYPE_PARENTS.has(t.type[t.parent[n]]) && t.field[n] === "type");

const typeName = (t: Flat, n: number): TypeName | null => {
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
const receiverType = (t: Flat, n: number): number => {
    const recv = namedChildren(t, child(t, n, "receiver"))[0];
    return recv !== undefined ? child(t, recv, "type") : -1;
};

const unit: LangRules["unit"] = (t, capture, node) => {
    const ty = t.type[node];
    if (capture === "definition.function" && ty === "function_declaration") return { kind: "function", nameNode: child(t, node, "name"), outer: node };
    if (capture === "definition.method" && ty === "method_declaration") return { kind: "method", nameNode: child(t, node, "name"), outer: node };
    if (capture === "definition.type" && (ty === "type_spec" || ty === "type_alias")) {
        // A lone `type X ...` takes its `type` keyword and doc comment; one in a `type ( ... )` group starts at itself.
        const p = t.parent[node];
        const lone = p >= 0 && t.type[p] === "type_declaration" && namedChildren(t, p).filter((c) => t.type[c] === "type_spec" || t.type[c] === "type_alias").length === 1;
        return { kind: "type", nameNode: child(t, node, "name"), outer: lone ? p : node };
    }
    return null;
};

export const GO: LangRules = {
    unit,
    label: (t, u) => {
        const recv = u.kind === "method" ? typeName(t, receiverType(t, u.node)) : null;
        const owner = recv?.kind === "name" ? textOf(t, recv.node) : recv?.kind === "qualified" ? recv.name : undefined;
        return labelOf({ name: u.name, kind: u.kind, ...(owner ? { parent: owner } : {}) }, "go");
    },
    scope: (t, n) => {
        const ty = t.type[n];
        if (ty === "function_declaration" || ty === "method_declaration" || ty === "func_literal") return "function";
        if (ty === "block" || ty === "if_statement" || ty === "for_statement" || ty === "expression_switch_statement" || ty === "type_switch_statement" || ty === "select_statement" || ty === "communication_case" || ty === "expression_case" || ty === "type_case" || ty === "default_case") return "block";
        // A generic type's parameters are its own.
        if ((ty === "type_spec" || ty === "type_alias") && child(t, n, "type_parameters") >= 0) return "block";
        return null;
    },
    binds,
    identifiers: new Set(["identifier", "type_identifier", "field_identifier", "package_identifier"]),
    role,
    isCallee,
    isType,
    imports,
};

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

const isTest = (path: string) => path.endsWith("_test.go");

const GOOS = new Set("aix android darwin dragonfly freebsd hurd illumos ios js linux nacl netbsd openbsd plan9 solaris wasip1 windows zos".split(" "));
const GOARCH = new Set("386 amd64 amd64p32 arm armbe arm64 arm64be loong64 mips mipsle mips64 mips64le mips64p32 mips64p32le ppc ppc64 ppc64le riscv riscv64 s390 s390x sparc sparc64 wasm".split(" "));
const UNIX = new Set("aix android darwin dragonfly freebsd hurd illumos ios linux netbsd openbsd solaris".split(" "));

/** A build constraint: tags joined by `!`, `&&` and `||`. */
type Expr = { op: "tag"; tag: string } | { op: "not"; x: Expr } | { op: "and"; a: Expr; b: Expr } | { op: "or"; a: Expr; b: Expr };

/** A `//go:build` expression, or null when it doesn't parse. */
const parseExpr = (src: string): Expr | null => {
    const tokens = src.match(/!|&&|\|\||\(|\)|[\w.]+/g) ?? [];
    let at = 0;
    const or = (): Expr | null => {
        let a = and();
        while (a && tokens[at] === "||") {
            at++;
            const b = and();
            a = b ? { op: "or", a, b } : null;
        }
        return a;
    };
    const and = (): Expr | null => {
        let a = not();
        while (a && tokens[at] === "&&") {
            at++;
            const b = not();
            a = b ? { op: "and", a, b } : null;
        }
        return a;
    };
    const not = (): Expr | null => {
        if (tokens[at] === "!") {
            at++;
            const x = not();
            return x ? { op: "not", x } : null;
        }
        if (tokens[at] === "(") {
            at++;
            const x = or();
            return tokens[at++] === ")" ? x : null;
        }
        const tag = tokens[at++];
        return tag && /^[\w.]+$/.test(tag) ? { op: "tag", tag } : null;
    };
    const e = or();
    return e && at === tokens.length ? e : null;
};

const all = (xs: Expr[]): Expr | null => xs.reduce<Expr | null>((a, b) => (a ? { op: "and", a, b } : b), null);

/**
 * A file's build constraint, as go/build reads it: its name's `_GOOS`,
 * `_GOARCH` or `_GOOS_GOARCH` before its first dot (a `_test` aside, so
 * `types_linux.pb.go` is linux's), and its `//go:build` line, else its
 * `// +build` lines, above the package clause. Null when it has none;
 * "unknown" when a line doesn't parse.
 */
const constraintOf = (path: string, text: string): Expr | null | "unknown" => {
    const terms: Expr[] = [];
    const base = path.split("/").pop() ?? "";
    const name = base.includes(".") ? base.slice(0, base.indexOf(".")) : base;
    const under = name.indexOf("_");
    if (under >= 0) {
        const l = name.slice(under).split("_");
        if (l[l.length - 1] === "test") l.pop();
        const n = l.length;
        if (n >= 2 && GOOS.has(l[n - 2]) && GOARCH.has(l[n - 1])) terms.push({ op: "tag", tag: l[n - 2] }, { op: "tag", tag: l[n - 1] });
        else if (n >= 1 && (GOOS.has(l[n - 1]) || GOARCH.has(l[n - 1]))) terms.push({ op: "tag", tag: l[n - 1] });
    }
    const header = text.slice(0, Math.max(0, text.search(/^\s*package\s/m)));
    const goBuild = /^\/\/go:build\s+(.+)$/m.exec(header);
    let unknown = false;
    if (goBuild) {
        const e = parseExpr(goBuild[1].trim());
        if (e) terms.push(e);
        else unknown = true;
    } else {
        for (const m of header.matchAll(/^\/\/\s*\+build\s+(.+)$/gm)) {
            // `a,b c`: (a && b) || c.
            const options = m[1].trim().split(/\s+/).map((o) => all(o.split(",").map((term) => (term.startsWith("!") ? { op: "not" as const, x: { op: "tag" as const, tag: term.slice(1) } } : { op: "tag" as const, tag: term }))));
            const line = options.reduce<Expr | null>((a, b) => (a && b ? { op: "or", a, b } : (a ?? b)), null);
            if (line) terms.push(line);
        }
    }
    return unknown ? "unknown" : all(terms);
};

/** A parsed file's build constraint, once per tree: a cache keyed by path would outlive the review that read it. */
const constraints = new WeakMap<Flat, Expr | null | "unknown">();
const constraintOfFile = (f: { path: string; flat: Flat }): Expr | null | "unknown" => {
    if (!constraints.has(f.flat)) constraints.set(f.flat, constraintOf(f.path, f.flat.text));
    return constraints.get(f.flat)!;
};

const tagsOf = (e: Expr, out = new Set<string>()): Set<string> => {
    if (e.op === "tag") out.add(e.tag);
    else if (e.op === "not") tagsOf(e.x, out);
    else {
        tagsOf(e.a, out);
        tagsOf(e.b, out);
    }
    return out;
};

type Env = { goos: string; goarch: string; on: ReadonlySet<string> };
const holds = (e: Expr, env: Env): boolean => {
    if (e.op === "not") return !holds(e.x, env);
    if (e.op === "and" || e.op === "or") return e.op === "and" ? holds(e.a, env) && holds(e.b, env) : holds(e.a, env) || holds(e.b, env);
    const tag = e.tag;
    if (GOOS.has(tag)) return tag === env.goos || (tag === "linux" && env.goos === "android") || (tag === "solaris" && env.goos === "illumos") || (tag === "darwin" && env.goos === "ios");
    if (GOARCH.has(tag)) return tag === env.goarch;
    if (tag === "unix") return UNIX.has(env.goos);
    if (/^go1\.\d+$/.test(tag)) return true;
    return env.on.has(tag);
};

/** Every build the tags allow: each GOOS and GOARCH, and each choice of the other tags, at most six of them. */
const builds = (exprs: Expr[]): Env[] | null => {
    const free = [...new Set(exprs.flatMap((e) => [...tagsOf(e)]))].filter((t) => !GOOS.has(t) && !GOARCH.has(t) && t !== "unix" && !/^go1\.\d+$/.test(t));
    if (free.length > 6) return null;
    const out: Env[] = [];
    for (const goos of GOOS) {
        for (const goarch of GOARCH) {
            for (let mask = 0; mask < 1 << free.length; mask++) out.push({ goos, goarch, on: new Set(free.filter((_, i) => mask & (1 << i))) });
        }
    }
    return out;
};

/** Whether every build that holds one file holds the other too: then a declaration there is the one this file's code sees. Kept per pair of trees. */
const reachCache = new WeakMap<Flat, WeakMap<Flat, boolean>>();
const reaches = (from: { path: string; flat: Flat }, to: { path: string; flat: Flat }): boolean => {
    if (from.path === to.path) return true;
    const target = constraintOfFile(to);
    if (target === null) return true;
    const source = constraintOfFile(from);
    if (target === "unknown" || source === "unknown") return false;
    let byTarget = reachCache.get(from.flat);
    if (!byTarget) reachCache.set(from.flat, (byTarget = new WeakMap()));
    let hit = byTarget.get(to.flat);
    if (hit === undefined) {
        const envs = builds(source ? [source, target] : [target]);
        hit = envs !== null && envs.every((env) => (source ? !holds(source, env) : false) || holds(target, env));
        byTarget.set(to.flat, hit);
    }
    return hit;
};

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

/** The go.mod files above a path, nearest first. */
export const goModsAbove = (path: string): string[] => {
    const dirs = path.split("/").slice(0, -1);
    const out: string[] = [];
    for (let k = dirs.length; k >= 0; k--) out.push([...dirs.slice(0, k), "go.mod"].join("/"));
    return out;
};

/** A file's package clause, read from its text. */
const clauseOf = (text: string): string | null => /^\s*package\s+([A-Za-z_]\w*)/m.exec(text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ""))?.[1] ?? null;

/** Whether no build holds a file: `//go:build ignore` and the like. */
const ignored = (path: string, text: string): boolean => {
    const c = constraintOf(path, text);
    if (c === null) return false;
    if (c === "unknown") return true;
    const envs = builds([c]);
    return envs === null ? false : envs.every((env) => env.on.has("ignore") || !holds(c, env));
};

/**
 * The files read of the package an import path names: the module from the
 * nearest go.mod read, then the folder under it. Never a test file, a file
 * no build holds, or a `package main`; and none when the files left don't
 * agree on one package name.
 */
const goModuleFiles = (from: string, spec: string, _level: number, ctx: ModuleContext): string[] => {
    for (const mod of goModsAbove(from)) {
        const text = ctx.text(mod);
        if (text === undefined) continue;
        const m = /^\s*module\s+("?)([^\s"]+)\1/m.exec(text);
        if (!m) return [];
        const modulePath = m[2];
        if (spec !== modulePath && !spec.startsWith(`${modulePath}/`)) return [];
        const root = mod.split("/").slice(0, -1).join("/");
        const dir = [root, spec.slice(modulePath.length).replace(/^\//, "")].filter((x) => x).join("/");
        // A folder under a go.mod of its own is another module, which this one may take at another version.
        const files = [...ctx.known].filter((p) => p.endsWith(".go") && !isTest(p) && p.split("/").slice(0, -1).join("/") === dir && goModsAbove(p).find((m) => ctx.text(m) !== undefined) === mod);
        const kept = files.filter((p) => {
            const body = ctx.text(p);
            return body === undefined || !ignored(p, body);
        });
        const names = new Set(kept.map((p) => clauseOf(ctx.text(p) ?? "")));
        return names.size === 1 && !names.has("main") && !names.has(null) ? kept : [];
    }
    return [];
};

export const GO_RESOLVER: Resolver = { typing: GO_TYPING, moduleFiles: goModuleFiles };
