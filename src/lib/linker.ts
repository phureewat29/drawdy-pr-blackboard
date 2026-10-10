/**
 * Which declaration each name refers to, across the files a pull request's
 * board reads: scopes inside a file, imports and re-exports between files,
 * and members through what a receiver is known to be.
 *
 * A file names another file's declaration only through an import. A member
 * (`x.y`) resolves when the receiver is known: `this`, `super`, a class or
 * namespace, a module, an object literal, or a local built with `new C()` or
 * typed `C`. Anything else resolves to nothing, and makes no link.
 */

import { lookup, NS, propName, requireSpec, TYPE, unwrap, VALUE, type Binding, type FileFacts, type ImportEntry, type Member, type Shape, type Site, type Unit } from "./facts.ts";
import type { PrRef } from "./github.ts";
import { child, namedChildren, textOf, tokensOf, type Flat } from "./syntax.ts";

export type PathMapping = { pattern: string; targets: string[] };

export type LinkerConfig = {
    /** tsconfig `paths` that apply to a file, targets already joined to `baseUrl` and made repo-relative. */
    paths: (from: string) => readonly PathMapping[];
    /** The file a bare import stands for in this repository (`builtinRule`), or null. */
    builtin: (spec: string) => string | null;
};

type Side = "static" | "instance";

/** What an expression is known to be. */
export type Val = {
    /** Declarations it names: what a reference to it links to. */
    units: Unit[];
    /** Object shapes it has, for member lookup. */
    shapes: { shape: Shape; side: Side; file: FileFacts }[];
    /** A module's namespace object. */
    module?: string;
    /** Why nothing is known; empty when the value is known (even if it holds nothing linkable). */
    unknown?: string;
    /** `super`: the prototype chain only, not own properties set in a constructor. */
    protoOnly?: boolean;
    /** An object from outside the read files (a built-in or a package): none of its members is a declaration here. */
    external?: string;
};

/** Utility types whose members come from their argument: `Partial<X>` has X's members. */
const SAME_MEMBERS = new Set(["Partial", "Required", "Readonly", "NonNullable", "Pick", "Omit"]);
/** Utility types that compute a new type from a function or a promise: unknown without a checker. */
const COMPUTED = new Set(["ReturnType", "Parameters", "ConstructorParameters", "Awaited", "ThisType", "ThisParameterType", "OmitThisParameter", "Extract", "Exclude", "Record", "InstanceType"]);

const NONE: Val = { units: [], shapes: [] };
const unknown = (why: string): Val => ({ units: [], shapes: [], unknown: why });
const merge = (...vs: Val[]): Val => {
    const known = vs.filter((v) => !v.unknown);
    if (known.length === 0) return vs[0] ?? unknown("nothing");
    return {
        units: [...new Set(known.flatMap((v) => v.units))],
        shapes: known.flatMap((v) => v.shapes),
        ...(known.find((v) => v.module) ? { module: known.find((v) => v.module)!.module } : {}),
        ...(vs.some((v) => v.unknown) ? { unknown: vs.find((v) => v.unknown)!.unknown } : {}),
    };
};

/** A reference that resolved: where it is, how it refers, and the declarations it names. */
export type Ref = { path: string; start: number; line: number; ref: Site["ref"]; units: Unit[] };

const CODE_EXT = [".ts", ".tsx", ".d.ts", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const JS_EXT = /\.(js|jsx|mjs|cjs)$/;

export const dirOf = (path: string) => path.split("/").slice(0, -1).join("/");
export const joinPath = (dir: string, rel: string): string => {
    const parts = dir ? dir.split("/") : [];
    for (const seg of rel.split("/")) {
        if (seg === "..") parts.pop();
        else if (seg !== "." && seg !== "") parts.push(seg);
    }
    return parts.join("/");
};

/** Repository paths an import may resolve to, in the order TypeScript and bundlers try them. */
export const moduleCandidates = (from: string, spec: string, paths: readonly PathMapping[]): { candidates: string[]; bare: boolean } => {
    const expand = (base: string): string[] => {
        const out: string[] = [];
        if (CODE_EXT.some((e) => base.endsWith(e))) out.push(base);
        if (JS_EXT.test(base)) {
            const stem = base.replace(JS_EXT, "");
            out.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, `${stem}.d.ts`);
        }
        for (const e of CODE_EXT) out.push(`${base}${e}`);
        for (const e of CODE_EXT) out.push(`${base}/index${e}`);
        return [...new Set(out)];
    };
    if (spec.startsWith("./") || spec.startsWith("../") || spec === "." || spec === "..") return { candidates: expand(joinPath(dirOf(from), spec)), bare: false };
    if (spec.startsWith("/")) return { candidates: expand(spec.slice(1)), bare: false };
    const out: string[] = [];
    const sorted = [...paths].sort((a, b) => b.pattern.replace("*", "").length - a.pattern.replace("*", "").length);
    for (const m of sorted) {
        const star = m.pattern.indexOf("*");
        let rest: string | null = null;
        if (star < 0) rest = spec === m.pattern ? "" : null;
        else if (spec.startsWith(m.pattern.slice(0, star)) && spec.endsWith(m.pattern.slice(star + 1)) && spec.length >= m.pattern.length - 1) rest = spec.slice(star, spec.length - (m.pattern.length - star - 1));
        if (rest === null) continue;
        for (const target of m.targets) out.push(...expand(star < 0 ? target : target.replace("*", rest)));
    }
    return { candidates: [...new Set(out)], bare: true };
};

export const createProgram = (files: readonly FileFacts[], config: LinkerConfig) => {
    const byPath = new Map(files.map((f) => [f.path, f]));

    // Module resolution, cached: a module not read is a package (bare) or missing, and names nothing.
    const resolved = new Map<string, { path?: string; external?: boolean }>();
    const resolveModule = (from: string, spec: string) => {
        const key = `${from}\0${spec}`;
        const hit = resolved.get(key);
        if (hit) return hit;
        const { candidates, bare } = moduleCandidates(from, spec, config.paths(from));
        const builtin = bare ? config.builtin(spec) : null;
        const path = candidates.find((c) => byPath.has(c)) ?? (builtin && byPath.has(builtin) ? builtin : undefined);
        const out = path ? { path } : { external: bare };
        resolved.set(key, out);
        return out;
    };

    // Values, memoized per file and node.
    const memo = new Map<FileFacts, Map<number, Val | null>>();
    const memoOf = (f: FileFacts) => {
        let m = memo.get(f);
        if (!m) memo.set(f, (m = new Map()));
        return m;
    };
    const shapeOf = (f: FileFacts, node: number) => f.shapes.get(node);
    const unitByValue = new Map<FileFacts, Map<number, Unit>>();
    const unitOfValue = (f: FileFacts, node: number): Unit | undefined => {
        let m = unitByValue.get(f);
        if (!m) {
            m = new Map();
            for (const u of f.units) if (u.valueNode >= 0) m.set(u.valueNode, u);
            unitByValue.set(f, m);
        }
        return m.get(node);
    };

    /** The value of a unit: what it names, and its shape. */
    const unitVal = (f: FileFacts, u: Unit): Val => {
        const t = f.flat;
        const own: Val = { units: [u], shapes: [] };
        if (u.kind === "class") {
            const s = shapeOf(f, u.valueNode);
            return s ? { units: [u], shapes: [{ shape: s, side: "static", file: f }] } : own;
        }
        if (u.kind === "function") {
            const s = shapeOf(f, u.valueNode);
            return s ? { units: [u], shapes: [{ shape: s, side: "static", file: f }] } : own;
        }
        if (u.kind === "namespace") {
            const s = shapeOf(f, u.valueNode);
            return s ? { units: [u], shapes: [{ shape: s, side: "static", file: f }] } : own;
        }
        if (u.kind === "type") {
            const s = shapeOf(f, u.valueNode);
            if (s) return { units: [u], shapes: [{ shape: s, side: "instance", file: f }] };
            if (t.type[u.valueNode] === "type_alias_declaration") return { ...typeVal(f, child(t, u.valueNode, "value")), units: [u] };
            return own;
        }
        if (u.kind === "value") {
            if (u.valueNode >= 0 && t.type[u.valueNode] === "object") {
                const s = shapeOf(f, u.valueNode);
                return s ? { units: [u], shapes: [{ shape: s, side: "instance", file: f }] } : own;
            }
            // A declarator's initializer or type, or an exported expression.
            const decl = t.type[u.node] === "variable_declarator" ? u.node : -1;
            if (decl >= 0) {
                const ty = child(t, decl, "type");
                const v = ty >= 0 ? typeVal(f, namedChildren(t, ty)[0] ?? -1) : evalExpr(f, child(t, decl, "value"));
                return { ...v, units: [u] };
            }
            if (u.valueNode >= 0) return { ...evalExpr(f, u.valueNode), units: [u] };
            return own;
        }
        return own;
    };

    /** What a binding holds, memoized; a cycle of imports is unknown. */
    const bindingMemo = new Map<Binding, Val | null>();
    const bindingVal = (f: FileFacts, b: Binding): Val => {
        if (bindingMemo.has(b)) return bindingMemo.get(b) ?? unknown("cycle");
        bindingMemo.set(b, null);
        const v = bindingUncached(f, b);
        bindingMemo.set(b, v);
        return v;
    };
    const bindingUncached = (f: FileFacts, b: Binding): Val => {
        if (b.kind === "import") {
            const entry = f.imports.find((i) => i.node === b.node || i.local === b.name);
            return entry ? importVal(f, entry) : unknown("import");
        }
        if (b.unit) return unitVal(f, b.unit);
        const t = f.flat;
        if (b.kind === "class") {
            const s = shapeOf(f, b.decl);
            return s ? { units: [], shapes: [{ shape: s, side: "static", file: f }] } : NONE;
        }
        if (b.kind === "function") return NONE;
        if (b.kind === "type") {
            const s = shapeOf(f, b.decl);
            if (s) return { units: [], shapes: [{ shape: s, side: "instance", file: f }] };
            if (t.type[b.decl] === "type_alias_declaration") return typeVal(f, child(t, b.decl, "value"));
            return NONE;
        }
        if (b.kind === "enum" || b.kind === "namespace") return NONE;
        if (b.kind === "typeparam") return unknown("type parameter");
        // Variables and parameters: the declared type, else the initializer; a destructured name follows its key path.
        if (b.typeNode >= 0 || b.init >= 0) {
            let v = b.typeNode >= 0 ? typeVal(f, b.typeNode) : evalExpr(f, b.init);
            for (const key of b.path ?? []) {
                if (key === "..." || /^\d+$/.test(key)) return unknown("destructured rest or array element");
                v = memberOf(v, key).next;
            }
            return v;
        }
        if (b.kind === "param") return unknown("untyped parameter");
        if (b.kind === "catch") return unknown("caught value");
        return unknown("variable without initializer");
    };

    /** An import's value: a module's export, its namespace, or what it assigns to module.exports. */
    const importVal = (f: FileFacts, entry: ImportEntry): Val => {
        const target = resolveModule(f.path, entry.spec);
        if (!target.path) return target.external ? { ...NONE, external: `package '${entry.spec}'` } : unknown(`missing module '${entry.spec}'`);
        if (entry.imported === "*") return { units: [], shapes: [], module: target.path };
        if (entry.imported === "=") return moduleVal(target.path);
        const v = exportVal(target.path, entry.imported, new Set());
        if (v) return v;
        if (entry.imported === "default") return moduleVal(target.path);
        return NONE;
    };

    /** What `require(path)` returns: module.exports, else the namespace, falling back to the default export (CommonJS interop). */
    const moduleVal = (path: string): Val => {
        const f = byPath.get(path);
        if (!f) return unknown(`unread module ${path}`);
        if (f.moduleExports >= 0) return evalExpr(f, f.moduleExports);
        const ns: Val = { units: [], shapes: [], module: path };
        if (!f.exports.some((e) => e.kind !== "star" && e.name === "default")) return ns;
        const d = exportVal(path, "default", new Set());
        return d && !d.unknown ? { ...ns, shapes: d.shapes, units: [] } : ns;
    };

    /** A module's export by name, through re-exports and `export *`. */
    const exportVal = (path: string, name: string, seen: Set<string>): Val | null => {
        const key = `${path}\0${name}`;
        if (seen.has(key)) return null;
        seen.add(key);
        const f = byPath.get(path);
        if (!f) return unknown(`unread module ${path}`);
        for (const e of f.exports) {
            if (e.kind === "star" || e.name !== name) continue;
            if (e.kind === "local") {
                const b = lookup(f.module, e.local, VALUE | TYPE | NS);
                return b ? bindingVal(f, b) : NONE;
            }
            if (e.kind === "expr") return evalExpr(f, e.value);
            if (e.kind === "reexport") {
                const target = resolveModule(path, e.spec);
                if (!target.path) return unknown(`re-export from external '${e.spec}'`);
                return exportVal(target.path, e.imported, seen) ?? NONE;
            }
            if (e.kind === "namespace") {
                const target = resolveModule(path, e.spec);
                return target.path ? { units: [], shapes: [], module: target.path } : unknown(`external '${e.spec}'`);
            }
        }
        if (name !== "default") {
            for (const e of f.exports) {
                if (e.kind !== "star") continue;
                const target = resolveModule(path, e.spec);
                if (!target.path) continue;
                const v = exportVal(target.path, name, seen);
                if (v && (v.units.length > 0 || v.shapes.length > 0 || v.module || !v.unknown)) return v;
            }
        }
        if (f.moduleExports >= 0) {
            const m = memberOf(evalExpr(f, f.moduleExports), name);
            if (m.found !== "no") return m.next.unknown ? { ...m.next, units: m.units } : { ...m.next, units: [...new Set([...m.units, ...m.next.units])] };
        }
        return null;
    };

    /** `this` at a node: the class instance, its static side, the object literal, or the constructor function's instance. */
    const thisVal = (f: FileFacts, node: number): Val => {
        const t = f.flat;
        let prev = node;
        for (let a = t.parent[node]; a >= 0; prev = a, a = t.parent[a]) {
            const ty = t.type[a];
            if (ty === "arrow_function") continue;
            if (ty === "public_field_definition" || ty === "field_definition") {
                if (t.field[prev] !== "value") continue;
                const cls = classOfBody(t, t.parent[a]);
                const s = cls >= 0 ? shapeOf(f, cls) : undefined;
                return s ? { units: [], shapes: [{ shape: s, side: tokensOf(t, a).includes("static") ? "static" : "instance", file: f }] } : unknown("this in a field");
            }
            if (ty === "class_static_block") {
                const cls = classOfBody(t, t.parent[a]);
                const s = cls >= 0 ? shapeOf(f, cls) : undefined;
                return s ? { units: [], shapes: [{ shape: s, side: "static", file: f }] } : unknown("this in a static block");
            }
            if (ty === "method_definition") {
                const holder = t.parent[a];
                if (t.type[holder] === "object") {
                    const s = shapeOf(f, holder);
                    return s ? { units: [], shapes: [{ shape: s, side: "instance", file: f }] } : unknown("this in an object method");
                }
                const cls = classOfBody(t, holder);
                const s = cls >= 0 ? shapeOf(f, cls) : undefined;
                const isStatic = tokensOf(t, a).includes("static");
                return s ? { units: [], shapes: [{ shape: s, side: isStatic ? "static" : "instance", file: f }] } : unknown("this in a method");
            }
            if (ty === "function_declaration" || ty === "generator_function_declaration") {
                const s = shapeOf(f, a);
                return s ? { units: [], shapes: [{ shape: s, side: "instance", file: f }] } : unknown("this in a nested function");
            }
            if (ty === "function_expression" || ty === "function" || ty === "generator_function") {
                let ctx = a;
                while (t.parent[ctx] >= 0 && t.type[t.parent[ctx]] === "parenthesized_expression") ctx = t.parent[ctx];
                const p = t.parent[ctx];
                if (p >= 0 && t.type[p] === "pair") {
                    const s = shapeOf(f, t.parent[p]);
                    return s ? { units: [], shapes: [{ shape: s, side: "instance", file: f }] } : unknown("this in an object function");
                }
                if (p >= 0 && t.type[p] === "assignment_expression" && t.field[ctx] === "right") {
                    const lhs = child(t, p, "left");
                    if (t.type[lhs] === "member_expression") {
                        const obj = unwrap(t, child(t, lhs, "object"));
                        // X.prototype.y = function, P.y = function (P = X.prototype): an instance of X.
                        const owner = protoOwner(f, obj);
                        if (owner) return asSide(owner, "instance");
                        // X.y = function: X itself.
                        return evalExpr(f, obj);
                    }
                }
                if (p >= 0 && t.type[p] === "variable_declarator") {
                    const s = shapeOf(f, a);
                    if (s) return { units: [], shapes: [{ shape: s, side: "instance", file: f }] };
                }
                return unknown("this in a function expression");
            }
            if (ty === "class_body" || ty === "program") break;
        }
        return unknown("top-level this");
    };

    /** For `X.prototype` or a prototype alias, X's value; else null. */
    const protoOwner = (f: FileFacts, obj: number): Val | null => {
        const t = f.flat;
        if (t.type[obj] === "identifier") {
            const owner = f.protoAliases.get(textOf(t, obj));
            if (owner) {
                const b = lookup(f.module, owner, VALUE);
                return b ? bindingVal(f, b) : null;
            }
            return null;
        }
        if (t.type[obj] === "member_expression" && propName(t, child(t, obj, "property")) === "prototype") return evalExpr(f, unwrap(t, child(t, obj, "object")));
        return null;
    };

    const asSide = (v: Val, side: Side): Val => ({
        units: [],
        shapes: v.shapes.map((s) => ({ ...s, side: s.shape.kind === "class" || s.shape.kind === "function" ? side : s.side })),
        ...(v.unknown ? { unknown: v.unknown } : {}),
    });

    /** What a type names: an instance of a class, an interface, a type literal. */
    const typeMemo = new Map<FileFacts, Map<number, Val | null>>();
    const typeVal = (f: FileFacts, n: number): Val => {
        if (n < 0) return unknown("no type");
        let m = typeMemo.get(f);
        if (!m) typeMemo.set(f, (m = new Map()));
        if (m.has(n)) return m.get(n) ?? unknown("cycle");
        m.set(n, null);
        const v = typeUncached(f, n);
        m.set(n, v);
        return v;
    };
    const typeUncached = (f: FileFacts, n: number): Val => {
        const t = f.flat;
        const ty = t.type[n];
        switch (ty) {
            case "type_annotation":
                return typeVal(f, namedChildren(t, n)[0] ?? -1);
            case "parenthesized_type":
                return typeVal(f, namedChildren(t, n)[0] ?? -1);
            case "type_identifier": {
                const scope = scopeAt(f, n);
                const name = textOf(t, n);
                const b = lookup(scope, name, TYPE);
                if (!b) return COMPUTED.has(name) || SAME_MEMBERS.has(name) ? unknown(`global type ${name}`) : { ...NONE, external: `global type ${name}` };
                return asSide(bindingVal(f, b), "instance");
            }
            case "generic_type": {
                const name = child(t, n, "name");
                const nameText = name >= 0 ? textOf(t, name) : "";
                const args = child(t, n, "type_arguments");
                const first = args >= 0 ? namedChildren(t, args)[0] : undefined;
                if (!lookup(scopeAt(f, n), nameText, TYPE)) {
                    if (SAME_MEMBERS.has(nameText) && first !== undefined) return typeVal(f, first);
                    if (nameText === "InstanceType" && first !== undefined && t.type[first] === "type_query") return asSide(typeVal(f, first), "instance");
                }
                return typeVal(f, name);
            }
            case "nested_type_identifier": {
                const mod = child(t, n, "module");
                const v = evalExpr(f, mod);
                return asSide(memberOf(v, textOf(t, child(t, n, "name"))).next, "instance");
            }
            case "union_type": {
                const parts = flattenUnion(t, n).filter((c) => !/^(null|undefined|void)$/.test(textOf(t, c)));
                if (parts.length === 0) return NONE;
                return merge(...parts.map((c) => typeVal(f, c)));
            }
            case "intersection_type":
                return merge(...namedChildren(t, n).map((c) => typeVal(f, c)));
            case "object_type": {
                const s = shapeOf(f, n);
                return s ? { units: [], shapes: [{ shape: s, side: "instance", file: f }] } : NONE;
            }
            case "type_query":
                return evalExpr(f, namedChildren(t, n)[0] ?? -1);
            case "lookup_type": {
                // T["k"]: the type of member k of T.
                const [obj, idx] = namedChildren(t, n);
                const lit = idx !== undefined && t.type[idx] === "literal_type" ? namedChildren(t, idx)[0] : undefined;
                if (obj === undefined || lit === undefined || t.type[lit] !== "string") return unknown("indexed type");
                return memberOf(typeVal(f, obj), propName(t, lit)).next;
            }
            case "predefined_type":
            case "literal_type":
            case "function_type":
            case "constructor_type":
            case "array_type":
            case "tuple_type":
            case "template_literal_type":
                return NONE;
            default:
                return unknown(`type ${ty}`);
        }
    };

    /** The scope a node sits in: the nearest ancestor that opens one. */
    const scopeAt = (f: FileFacts, n: number) => {
        const t = f.flat;
        for (let a = t.parent[n]; a >= 0; a = t.parent[a]) {
            const s = f.scopeOfNode.get(a);
            if (s) return s;
        }
        return f.module;
    };

    /** What an expression evaluates to. */
    const evalExpr = (f: FileFacts, n: number): Val => {
        if (n < 0) return unknown("no expression");
        const m = memoOf(f);
        if (m.has(n)) return m.get(n) ?? unknown("cycle");
        m.set(n, null);
        const v = evalUncached(f, n);
        m.set(n, v);
        return v;
    };
    const evalUncached = (f: FileFacts, n: number): Val => {
        const t = f.flat;
        const ty = t.type[n];
        switch (ty) {
            case "identifier":
            case "shorthand_property_identifier": {
                const name = textOf(t, n);
                const b = lookup(scopeAt(f, n), name, VALUE | NS);
                if (b) return bindingVal(f, b);
                if (name === "exports") return moduleVal(f.path);
                return unknown(`global ${name}`);
            }
            case "this":
                return thisVal(f, n);
            case "parenthesized_expression":
            case "as_expression":
            case "satisfies_expression":
            case "non_null_expression":
            case "type_assertion":
                return evalExpr(f, unwrap(t, n));
            case "member_expression": {
                const obj = child(t, n, "object");
                const name = propName(t, child(t, n, "property"));
                if (t.type[obj] === "identifier" && textOf(t, obj) === "module" && !lookup(scopeAt(f, n), "module", VALUE) && name === "exports") return moduleVal(f.path);
                if (name === "prototype") return asSide(evalExpr(f, obj), "instance");
                return memberOf(receiverVal(f, obj), name).next;
            }
            case "subscript_expression": {
                const idx = child(t, n, "index");
                if (t.type[idx] !== "string") return unknown("computed member");
                return memberOf(receiverVal(f, child(t, n, "object")), propName(t, idx)).next;
            }
            case "new_expression": {
                const ctor = child(t, n, "constructor");
                // A global constructor (Map, Error, URL...) never builds one of the read files' classes.
                if (t.type[ctor] === "identifier" && !lookup(scopeAt(f, n), textOf(t, ctor), VALUE)) return { ...NONE, external: `new ${textOf(t, ctor)}` };
                const c = evalExpr(f, ctor);
                if (c.external) return { ...NONE, external: c.external };
                if (c.unknown) return unknown(`new on ${c.unknown}`);
                return asSide(c, "instance");
            }
            case "call_expression": {
                const spec = requireSpec(t, n, scopeAt(f, n));
                if (spec !== null) {
                    const target = resolveModule(f.path, spec);
                    if (target.path) return moduleVal(target.path);
                    return unknown(`external module '${spec}'`);
                }
                const fn = child(t, n, "function");
                const fnText = fn >= 0 ? textOf(t, fn) : "";
                // Calls that return their first argument: freeze, seal, assign.
                if (/^(Object\.)?(freeze|seal|assign)$|^Object(Freeze|Seal|Assign)$/.test(fnText)) {
                    const args = child(t, n, "arguments");
                    const first = args >= 0 ? namedChildren(t, args)[0] : undefined;
                    if (first !== undefined) return evalExpr(f, first);
                }
                return unknown("call result");
            }
            case "await_expression": {
                const inner = namedChildren(t, n)[0];
                if (inner !== undefined && t.type[inner] === "call_expression" && t.type[child(t, inner, "function")] === "import") {
                    const args = child(t, inner, "arguments");
                    const first = args >= 0 ? namedChildren(t, args)[0] : undefined;
                    const spec = first !== undefined && t.type[first] === "string" ? propName(t, first) : null;
                    const target = spec ? resolveModule(f.path, spec) : null;
                    if (target?.path && byPath.has(target.path)) return { units: [], shapes: [], module: target.path };
                }
                return unknown("awaited value");
            }
            case "assignment_expression": {
                const lhs = child(t, n, "left");
                if (t.type[lhs] === "member_expression" && propName(t, child(t, lhs, "property")) === "prototype") return evalExpr(f, lhs);
                return evalExpr(f, child(t, n, "right"));
            }
            case "ternary_expression":
                return merge(evalExpr(f, child(t, n, "consequence")), evalExpr(f, child(t, n, "alternative")));
            case "binary_expression": {
                const op = tokensOf(t, n).find((x) => x === "||" || x === "??" || x === "&&");
                if (!op) return NONE;
                return merge(evalExpr(f, child(t, n, "left")), evalExpr(f, child(t, n, "right")));
            }
            case "object": {
                const s = shapeOf(f, n);
                const u = unitOfValue(f, n);
                return { units: u ? [u] : [], shapes: s ? [{ shape: s, side: "instance", file: f }] : [] };
            }
            case "class": {
                const s = shapeOf(f, n);
                const u = unitOfValue(f, n);
                return { units: u ? [u] : [], shapes: s ? [{ shape: s, side: "static", file: f }] : [] };
            }
            case "function_expression":
            case "function":
            case "arrow_function":
            case "generator_function": {
                const u = unitOfValue(f, n);
                const s = shapeOf(f, n);
                return { units: u ? [u] : [], shapes: s ? [{ shape: s, side: "static", file: f }] : [] };
            }
            case "string":
            case "template_string":
            case "number":
            case "true":
            case "false":
            case "null":
            case "undefined":
            case "regex":
            case "array":
            case "unary_expression":
            case "update_expression":
                return NONE;
            default:
                return unknown(`expression ${ty}`);
        }
    };

    /** The receiver of a member access: `super` is the base class, everything else evaluates. */
    const receiverVal = (f: FileFacts, obj: number): Val => {
        const t = f.flat;
        if (obj >= 0 && t.type[obj] === "super") {
            const self = thisVal(f, obj);
            if (self.unknown) return self;
            const bases = self.shapes.flatMap((s) => s.shape.heritage.map((h) => ({ h, side: s.side, file: s.file })));
            if (bases.length === 0) return unknown("super without a base class");
            // super reads the base's prototype: not what a constructor assigns to `this`.
            return { ...merge(...bases.map((b) => asSide(evalExpr(b.file, b.h), b.side))), protoOnly: true };
        }
        return evalExpr(f, obj);
    };

    /** Members of a shape on one side, including module-level assignments to it; cached per shape and side. */
    const memberCache = new Map<Shape, Map<Side, Member[]>>();
    const membersOf = (s: Shape, side: Side, f: FileFacts): Member[] => {
        let bySide = memberCache.get(s);
        if (!bySide) memberCache.set(s, (bySide = new Map()));
        let list = bySide.get(side);
        if (!list) bySide.set(side, (list = membersUncached(s, side, f)));
        return list;
    };
    const membersUncached = (s: Shape, side: Side, f: FileFacts): Member[] => {
        const own = s.members.filter((m) => (s.kind === "class" || s.kind === "function" ? m.static === (side === "static") : true));
        if (s.kind !== "class" && s.kind !== "function") return own;
        const extra: Member[] = [];
        for (const a of f.assignments) {
            if (a.owner !== s.name || a.proto !== (side === "instance")) continue;
            if (a.name === "*") {
                const os = f.shapes.get(a.value);
                if (os) extra.push(...os.members);
                continue;
            }
            extra.push({ name: a.name, static: side === "static", kind: "proto", node: a.node, nameStart: a.nameStart, ...(a.unit ? { unit: a.unit } : {}), value: a.value, typeNode: -1 });
        }
        // A constructor function's `this.x = v` lines belong to its instances.
        return [...own, ...extra];
    };

    type MemberHit = { units: Unit[]; next: Val; found: "yes" | "no" | "unknown"; why?: string };

    /**
     * A member of a value by name. A write defines the member, so it never
     * follows an alias to what the member held. A member set only on some
     * paths (`if (x) this.emit = f`) beside one always set names only the one
     * always set.
     */
    const memberOf = (v: Val, name: string, depth = 0, write = false): MemberHit => {
        if (depth > 8) return { units: [], next: unknown("deep inheritance"), found: "unknown", why: "deep inheritance" };
        if (v.module) {
            const e = exportVal(v.module, name, new Set());
            if (e) return { units: e.units, next: e, found: e.unknown && e.units.length === 0 ? "unknown" : "yes", ...(e.unknown ? { why: e.unknown } : {}) };
            // Not a named export: the default export's members, when require() handed it back.
            if (v.shapes.length === 0) return { units: [], next: NONE, found: "no" };
        }
        if (v.external && v.shapes.length === 0 && !v.module) return { units: [], next: { ...NONE, external: v.external }, found: "no" };
        if (v.unknown && v.shapes.length === 0) return { units: [], next: unknown(`member of ${v.unknown}`), found: "unknown", why: v.unknown };
        if (v.shapes.length === 0) return { units: [], next: NONE, found: "no" };
        const units: Unit[] = [];
        const nexts: Val[] = [];
        let found = false;
        let open = false;
        let why = "";
        for (const { shape, side, file } of v.shapes) {
            if (name === "prototype" && side === "static" && (shape.kind === "class" || shape.kind === "function")) {
                nexts.push({ units: [], shapes: [{ shape, side: "instance", file }] });
                found = true;
                continue;
            }
            const hits = membersOf(shape, side, file).filter((m) => m.name === name && !(v.protoOnly && m.kind === "this"));
            if (hits.length > 0) {
                found = true;
                const always = hits.some((m) => !m.conditional);
                for (const m of hits) {
                    const value = memberValue(file, m);
                    nexts.push(m.unit ? { ...value, units: [m.unit] } : value);
                    if (m.conditional && always) continue;
                    if (m.unit) units.push(m.unit);
                    // An alias (`P.on = P.addListener`, `proto.emit = emitFn`) names what it points at.
                    if (!write && !m.unit && (m.kind === "proto" || m.kind === "pair" || m.kind === "shorthand" || m.kind === "this" || m.kind === "field")) units.push(...value.units.filter((u) => u.kind === "function" || u.kind === "method"));
                }
                continue;
            }
            if (shape.open) open = true;
            // Inherited: the base class (or interface) on the same side.
            for (const h of shape.heritage) {
                const base = shape.kind === "interface" ? typeVal(file, h) : asSide(evalExpr(file, h), side);
                if ((base.unknown || base.external) && base.shapes.length === 0) {
                    // Inherited from outside the read files: a member not declared here may still be the base's.
                    if (base.external) {
                        why ||= `inherits from ${base.external}`;
                        continue;
                    }
                    open = true;
                    why ||= `inherits from ${base.unknown}`;
                    continue;
                }
                const r = memberOf(base, name, depth + 1, write);
                if (r.found === "yes") {
                    found = true;
                    units.push(...r.units);
                    nexts.push(r.next);
                } else if (r.found === "unknown") {
                    open = true;
                    why ||= r.why ?? "inherited";
                }
            }
        }
        if (found) return { units: [...new Set(units)], next: merge(...nexts), found: "yes" };
        if (open || v.unknown) return { units: [], next: unknown(why || "open object"), found: "unknown", why: why || v.unknown || "open object" };
        return { units: [], next: NONE, found: "no" };
    };

    /** A member's value, for chains like `this.cursor.reset()`. */
    const memberValue = (f: FileFacts, m: Member): Val => {
        const t = f.flat;
        if (m.kind === "method" || m.kind === "get" || m.kind === "set" || m.kind === "signature") {
            // A getter's value is unknown without return types; a method is itself.
            return m.unit ? { units: [m.unit], shapes: [] } : NONE;
        }
        if (m.typeNode >= 0) return typeVal(f, m.typeNode);
        if (m.kind === "shorthand") {
            const b = lookup(scopeAt(f, m.value), textOf(t, m.value), VALUE);
            return b ? bindingVal(f, b) : unknown("shorthand");
        }
        if (m.value >= 0) return evalExpr(f, m.value);
        return unknown("member without value");
    };

    /** The declarations one site names; none when it names a local, a key, a global, a package or a member of anything unknown. */
    const resolveSite = (f: FileFacts, s: Site): Unit[] => {
        const t = f.flat;
        if (s.form === "import" && s.importEntry) return s.importEntry.imported === "*" ? [] : importVal(f, s.importEntry).units;
        if (s.form === "require" && s.keyPath) {
            // The declarator's require() and the key path into the module.
            let a = s.node;
            while (a >= 0 && t.type[a] !== "variable_declarator") a = t.parent[a];
            let v = a >= 0 ? evalExpr(f, child(t, a, "value")) : unknown("require");
            for (const key of s.keyPath) {
                if (key === "..." || /^\d+$/.test(key)) return [];
                const m = memberOf(v, key);
                v = m.units.length > 0 ? { ...m.next, units: m.units } : m.next;
            }
            return v.units;
        }
        if (s.form === "export" && s.exportEntry) {
            const e = s.exportEntry;
            if (e.kind === "local") {
                const b = lookup(f.module, e.local, VALUE | TYPE | NS);
                return !b ? [] : b.unit ? [b.unit] : b.kind === "import" ? bindingVal(f, b).units : [];
            }
            if (e.kind === "reexport") {
                const target = resolveModule(f.path, e.spec);
                return target.path ? (exportVal(target.path, e.imported, new Set())?.units ?? []) : [];
            }
            return [];
        }
        if (s.form === "bare") {
            const meaning = t.type[s.node] === "type_identifier" ? TYPE : s.ref === "type" && t.type[t.parent[s.node]] === "nested_type_identifier" ? NS | VALUE : VALUE | NS;
            const b = lookup(s.scope, s.name, meaning);
            if (!b) return [];
            if (b.kind === "import") {
                // A namespace import or whole-module require names no declaration itself.
                const entry = f.imports.find((i) => i.node === b.node || i.local === b.name);
                return entry && (entry.imported === "*" || entry.imported === "=") ? [] : bindingVal(f, b).units;
            }
            // `const X = require('m')` (or a member of it) is an alias, as TypeScript reads JavaScript: X also names what it holds.
            return b.unit ? [b.unit, ...requireAlias(f, b)] : [];
        }
        const recv = t.type[t.parent[s.node]] === "nested_type_identifier" ? evalExpr(f, s.receiver) : receiverVal(f, s.receiver);
        const hit = memberOf(recv, s.name, 0, s.ref === "write");
        return hit.found === "yes" ? hit.units : [];
    };

    /** For `const X = require('m')` or `const X = require('m').a.b`: the declarations X holds. */
    const requireAlias = (f: FileFacts, b: Binding): Unit[] => {
        const t = f.flat;
        if (b.init < 0 || b.path) return [];
        const keys: string[] = [];
        let e = unwrap(t, b.init);
        while (e >= 0 && t.type[e] === "member_expression") {
            keys.unshift(propName(t, child(t, e, "property")));
            e = unwrap(t, child(t, e, "object"));
        }
        const spec = requireSpec(t, e, scopeAt(f, e));
        const target = spec === null ? null : resolveModule(f.path, spec);
        const m = target?.path ? byPath.get(target.path) : undefined;
        if (!m) return [];
        let v: Val = m.moduleExports >= 0 ? evalExpr(m, m.moduleExports) : (exportVal(m.path, "default", new Set()) ?? { units: [], shapes: [], module: m.path });
        if (keys.length > 0) v = moduleVal(m.path);
        for (const k of keys) {
            const hit = memberOf(v, k);
            v = hit.units.length > 0 ? { ...hit.next, units: hit.units } : hit.next;
        }
        return v.units.filter((u) => u !== b.unit);
    };

    return { resolveModule, resolveSite };
};

/**
 * Every reference that names a declaration, in the files that can hold a
 * card: the changed files and the files that import one. The other files
 * lend their declarations.
 */
export const resolveAll = (files: readonly FileFacts[], changed: ReadonlySet<string>, config: LinkerConfig): Ref[] => {
    const program = createProgram(files, config);
    const holdsCards = (f: FileFacts) => changed.has(f.path) || f.specifiers.some((sp) => changed.has(program.resolveModule(f.path, sp.spec).path ?? ""));
    const refs: Ref[] = [];
    for (const f of files) {
        if (!holdsCards(f)) continue;
        for (const s of f.sites) {
            const units = program.resolveSite(f, s);
            if (units.length > 0) refs.push({ path: f.path, start: s.start, line: s.line, ref: s.ref, units });
        }
    }
    return refs;
};

/** Node 24's `builtinModules`; the last four exist only with the `node:` prefix. */
const NODE_BUILTINS = new Set([
    "_http_agent", "_http_client", "_http_common", "_http_incoming", "_http_outgoing", "_http_server", "_stream_duplex", "_stream_passthrough", "_stream_readable",
    "_stream_transform", "_stream_wrap", "_stream_writable", "_tls_common", "_tls_wrap", "assert", "assert/strict", "async_hooks", "buffer", "child_process", "cluster",
    "console", "constants", "crypto", "dgram", "diagnostics_channel", "dns", "dns/promises", "domain", "events", "fs", "fs/promises", "http", "http2", "https",
    "inspector", "inspector/promises", "module", "net", "os", "path", "path/posix", "path/win32", "perf_hooks", "process", "punycode", "querystring", "readline",
    "readline/promises", "repl", "stream", "stream/consumers", "stream/promises", "stream/web", "string_decoder", "sys", "timers", "timers/promises", "tls",
    "trace_events", "tty", "url", "util", "util/types", "v8", "vm", "wasi", "worker_threads", "zlib", "node:sea", "node:sqlite", "node:test", "node:test/reporters",
]);

/**
 * The one guess the linker takes, in the two repositories that implement
 * Node's built-in modules: there a bare `x` or `node:x` import of a built-in
 * means the repository's own file, when the pull request changes it.
 * nodejs/node serves `x` from `lib/x.js`; oven-sh/bun from
 * `src/js/node/x.ts`, with `/` read as `.` (`fs/promises` is
 * `src/js/node/fs.promises.ts`).
 */
export const builtinRule = (base: PrRef, changed: ReadonlySet<string>): LinkerConfig["builtin"] => {
    const repo = `${base.owner}/${base.repo}`.toLowerCase();
    const fileOf = repo === "nodejs/node" ? (name: string) => `lib/${name}.js` : repo === "oven-sh/bun" ? (name: string) => `src/js/node/${name.replaceAll("/", ".")}.ts` : null;
    if (!fileOf) return () => null;
    return (spec) => {
        const name = spec.replace(/^node:/, "");
        if (!NODE_BUILTINS.has(spec) && !(NODE_BUILTINS.has(name) && !NODE_BUILTINS.has(`node:${name}`))) return null;
        const path = fileOf(name);
        return changed.has(path) ? path : null;
    };
};

const classOfBody = (t: Flat, body: number): number => (body >= 0 && t.type[body] === "class_body" ? t.parent[body] : -1);
const flattenUnion = (t: Flat, n: number): number[] => (t.type[n] === "union_type" ? namedChildren(t, n).flatMap((c) => flattenUnion(t, c)) : [n]);

