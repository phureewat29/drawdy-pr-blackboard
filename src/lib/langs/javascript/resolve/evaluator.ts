/**
 * What each expression, type, binding, import and member is known to be:
 * the declarations it names and the shapes it has. Values are computed once
 * per node, and a node met again while its own value is being computed is
 * unknown, so the order things are evaluated in is part of the result: keep
 * it when changing this.
 */

import { child, hasToken, namedChildren, textOf, tokensOf, type Flat } from "../../../syntax.ts";
import type { Unit } from "../../pack.ts";
import { scopeAt, type Binding, type ExportEntry, type FileFacts, type ImportEntry, type Member, type Shape } from "../facts.ts";
import { requireSpec } from "../facts/modules.ts";
import { docTypeParts, fieldDocType, memberDocType, paramDocType, templatesAt, typedefAt, variableDocType } from "../facts/jsdoc.ts";
import { annotatedType, assertedType, firstStringArgument, holderOf, propName, unwrap } from "../facts/nodes.ts";
import { lookup, NS, TYPE, VALUE } from "../facts/scopes.ts";
import type { LinkerConfig } from "../resolve.ts";
import { implementations, moduleCandidates } from "./paths.ts";
import { asSide, external, hasSides, intersect, merge, namespace, NONE, perNode, shaped, unknown, type Side, type Val } from "./values.ts";

/** Utility types whose members come from their argument: `Partial<X>` has X's members. */
const SAME_MEMBERS = new Set(["Partial", "Required", "Readonly", "NonNullable", "Pick", "Omit"]);
/** Utility types that compute a new type from a function or a promise: unknown without a checker. */
const COMPUTED = new Set(["ReturnType", "Parameters", "ConstructorParameters", "Awaited", "ThisType", "ThisParameterType", "OmitThisParameter", "Extract", "Exclude", "Record", "InstanceType"]);
const FUNCTION_EXPRESSIONS = new Set(["function_expression", "function", "generator_function"]);
/** Calls that return their first argument. */
const RETURNS_FIRST = /^(Object\.)?(freeze|seal|assign)$|^Object(Freeze|Seal|Assign)$/;

/** A key a destructuring takes by position, a rest or an array element: its value is unknown. */
export const positional = (key: string) => key === "..." || /^\d+$/.test(key);
const classOfBody = (t: Flat, body: number): number => (t.type[body] === "class_body" ? t.parent[body] : -1);
const flattenUnion = (t: Flat, n: number): number[] => (t.type[n] === "union_type" ? namedChildren(t, n).flatMap((c) => flattenUnion(t, c)) : [n]);
/** The import a binding stands for: by its name token, or for an alias, by its local name. */
export const importOf = (f: FileFacts, b: Binding) => f.imports.find((i) => i.node === b.node || i.local === b.name);

type NamedExport = Exclude<ExportEntry, { kind: "star" }>;

/** How a site uses a member: reads it, writes it (`x.a = v`), both (`x.a += v`, `x.a++`), or removes it (`delete x.a`). */
export type Access = "read" | "write" | "update" | "delete";

/** A member's lookup: the declarations it names, its value, and whether it exists (unknown when the object may hold more). */
type MemberHit = { units: Unit[]; next: Val; found: "yes" | "no" | "unknown"; why?: string };
const NOT_FOUND: MemberHit = { units: [], next: NONE, found: "no" };

/** The TypeScript files TypeScript tries for a JavaScript path, in its order: `x.ts`, `x.tsx`, `x.d.ts` for `x.js`; `x.mts`, `x.d.mts` for `x.mjs`; `x.cts`, `x.d.cts` for `x.cjs`; `x.tsx`, `x.d.ts` for `x.jsx`. */
const typeSources = (path: string): string[] => {
    const m = /\.(js|mjs|cjs|jsx)$/.exec(path);
    if (!m) return [];
    const stem = path.slice(0, m.index);
    return m[1] === "js" ? [`${stem}.ts`, `${stem}.tsx`, `${stem}.d.ts`] : m[1] === "mjs" ? [`${stem}.mts`, `${stem}.d.mts`] : m[1] === "cjs" ? [`${stem}.cts`, `${stem}.d.cts`] : [`${stem}.tsx`, `${stem}.d.ts`];
};

/** Whether an expression is a name or a dotted name (`a`, `a.b.c`), which TypeScript resolves as an entity. */
const entityName = (t: Flat, n: number): boolean => t.type[n] === "identifier" || (t.type[n] === "member_expression" && t.type[child(t, n, "property")] === "property_identifier" && entityName(t, child(t, n, "object")));

export const createEvaluator = (files: readonly FileFacts[], config: LinkerConfig) => {
    const byPath = new Map(files.map((f) => [f.path, f]));

    // Modules. One not read is a package (bare) or missing, and names nothing.
    const resolved = new Map<string, { path?: string; external?: boolean }>();
    const resolveModule = (from: string, spec: string) => {
        const key = `${from}\0${spec}`;
        const hit = resolved.get(key);
        if (hit) return hit;
        const { candidates, bare } = moduleCandidates(from, spec, config.paths(from));
        const builtin = bare ? config.builtin(spec) : null;
        // An import the read tier followed names the first candidate it found, parsed or not. One it didn't follow names
        // the first one parsed, once every candidate before it is known missing; one there or never asked stands in the way.
        const answer = config.answered?.(from, spec);
        let found: string | null | undefined = answer;
        if (answer === undefined) found = firstThere(candidates);
        // `./x.js` never asked for: TypeScript takes x.ts first for it (x.mts for x.mjs, x.cts for x.cjs, x.tsx for x.jsx), so one parsed is proven all the same.
        if (answer === undefined && found === undefined) {
            const sources = typeSources(candidates[0] ?? "");
            if (sources.length > 0) found = firstThere(sources);
        }
        // A declaration file stands for the JavaScript beside it, the code that runs.
        if (typeof found === "string" && answer === undefined) found = firstThere([...implementations(found), found]);
        // The builtin rule only for a bare import no candidate stands for.
        const path = typeof found === "string" ? (byPath.has(found) ? found : undefined) : found === null && builtin && byPath.has(builtin) ? builtin : undefined;
        const out = path ? { path } : { external: bare && found === null };
        resolved.set(key, out);
        return out;
    };

    /** The first path parsed, those before it all known missing (any, without `exists`); null when none is, undefined when one there or never asked stands in the way. */
    const firstThere = (paths: readonly string[]): string | null | undefined => {
        for (const p of paths) {
            if (byPath.has(p)) return p;
            if (config.exists && config.exists(p) !== false) return config.exists(p) ? p : undefined;
        }
        return null;
    };

    /** An import's value: a module's export, its namespace, or what it assigns to module.exports. */
    const importVal = (f: FileFacts, entry: ImportEntry): Val => {
        const target = resolveModule(f.path, entry.spec);
        if (!target.path) return target.external ? external(`package '${entry.spec}'`) : unknown(`missing module '${entry.spec}'`);
        if (entry.imported === "*") return namespace(target.path);
        if (entry.imported === "=") return moduleVal(target.path);
        const v = exportVal(target.path, entry.imported, new Set());
        if (v) return v;
        return entry.imported === "default" ? moduleVal(target.path) : NONE;
    };

    /** What `require(path)` returns: module.exports, else the namespace with the default export's members (CommonJS interop). */
    const moduleVal = (path: string): Val => {
        const f = byPath.get(path);
        if (!f) return unknown(`unread module ${path}`);
        if (f.moduleExports >= 0) return evalExpr(f, f.moduleExports);
        const ns = namespace(path);
        if (!f.exports.some((e) => e.kind !== "star" && e.name === "default")) return ns;
        const d = exportVal(path, "default", new Set());
        return d && !d.unknown ? { ...ns, shapes: d.shapes, units: [] } : ns;
    };

    /** A module's export by name, through re-exports, `export *` and module.exports; null when it has none. */
    const exportVal = (path: string, name: string, seen: Set<string>): Val | null => {
        const key = `${path}\0${name}`;
        if (seen.has(key)) return null;
        seen.add(key);
        const f = byPath.get(path);
        if (!f) return unknown(`unread module ${path}`);
        const own = f.exports.find((e): e is NamedExport => e.kind !== "star" && e.name === name);
        if (own) return namedExport(f, own, seen);
        const starred = name === "default" ? null : starExport(f, name, seen);
        if (starred) return starred;
        if (f.moduleExports < 0) return null;
        const m = memberOf(evalExpr(f, f.moduleExports), name);
        if (m.found === "no") return null;
        return m.next.unknown ? { ...m.next, units: m.units } : { ...m.next, units: [...new Set([...m.units, ...m.next.units])] };
    };
    const namedExport = (f: FileFacts, e: NamedExport, seen: Set<string>): Val => {
        switch (e.kind) {
            case "local": {
                const b = lookup(f.module, e.local, VALUE | TYPE | NS);
                return b ? bindingVal(f, b) : NONE;
            }
            case "expr": {
                // `export default <expression>` is the statement's own unit, as TypeScript's definition of the default export is; but
                // `export default a.b` exports what a.b names, which TypeScript takes the default export to stand for.
                const v = evalExpr(f, e.value);
                const own = f.units.find((u) => u.name === "default" && !u.parent && u.node === f.flat.parent[e.value]);
                return own && !entityName(f.flat, unwrap(f.flat, e.value)) ? { ...v, units: [own] } : v;
            }
            case "reexport": {
                const target = resolveModule(f.path, e.spec);
                return target.path ? (exportVal(target.path, e.imported, seen) ?? NONE) : unknown(`re-export from external '${e.spec}'`);
            }
            case "namespace": {
                const target = resolveModule(f.path, e.spec);
                return target.path ? namespace(target.path) : unknown(`external '${e.spec}'`);
            }
            case "unit":
                return { units: [e.unit], shapes: [] };
        }
    };
    /** The first `export *` that knows the name. */
    const starExport = (f: FileFacts, name: string, seen: Set<string>): Val | null => {
        for (const e of f.exports) {
            if (e.kind !== "star") continue;
            const target = resolveModule(f.path, e.spec);
            if (!target.path) continue;
            const v = exportVal(target.path, name, seen);
            if (v && (v.units.length > 0 || v.shapes.length > 0 || v.module || !v.unknown)) return v;
        }
        return null;
    };

    // Bindings and units.
    const bindings = new Map<Binding, Val | null>();
    /** What a binding holds, computed once; a binding met again while its value is being computed (a cycle of imports) is unknown. */
    const bindingVal = (f: FileFacts, b: Binding): Val => {
        if (bindings.has(b)) return bindings.get(b) ?? unknown("cycle");
        bindings.set(b, null);
        const v = bindingUncached(f, b);
        bindings.set(b, v);
        return v;
    };
    const bindingUncached = (f: FileFacts, b: Binding): Val => {
        if (b.kind === "import") {
            const entry = importOf(f, b);
            return entry ? importVal(f, entry) : unknown("import");
        }
        // A value with a declared type is what its type says, as TypeScript reads it: the object literal it starts as lends no members.
        if (b.unit) return b.unit.kind === "value" && b.typeNode >= 0 ? { ...typeVal(f, b.typeNode), units: [b.unit] } : unitVal(f, b.unit);
        switch (b.kind) {
            case "class":
                return staticSide(f, b.decl);
            case "type":
                return declaredType(f, b.decl);
            case "function":
            case "enum":
            case "namespace":
                return NONE;
            case "typeparam":
                return unknown("type parameter");
        }
        // Variables and parameters: the declared type (in JavaScript, a JSDoc one), else the initializer; a destructured name follows its key path.
        const doc = f.docTypes && b.typeNode < 0 && !b.path?.length ? (b.kind === "param" ? paramDocType(f.flat, b.node) : variableDocType(f.flat, f.flat.parent[b.node])) : null;
        if (doc !== null) return docTypeVal(f, doc, b.node);
        if (b.typeNode < 0 && b.init < 0) return unknown(b.kind === "param" ? "untyped parameter" : b.kind === "catch" ? "caught value" : "variable without initializer");
        let v = b.typeNode >= 0 ? typeVal(f, b.typeNode) : evalExpr(f, b.init);
        for (const key of b.path ?? []) {
            if (positional(key)) return unknown("destructured rest or array element");
            v = memberOf(v, key).next;
        }
        return v;
    };

    /** The value of a unit: what it names, and its shape. */
    const unitVal = (f: FileFacts, u: Unit): Val => {
        switch (u.kind) {
            case "class":
            case "function":
            case "namespace":
                return { ...staticSide(f, u.valueNode), units: [u] };
            case "type":
                return { ...declaredType(f, u.valueNode), units: [u] };
            case "value":
                return { ...valueUnitVal(f, u), units: [u] };
            default:
                return { units: [u], shapes: [] };
        }
    };
    /** A class, constructor function or namespace itself. */
    const staticSide = (f: FileFacts, node: number): Val => {
        const s = f.shapes.get(node);
        return s ? shaped(s, "static", f) : NONE;
    };
    /** An interface's or type literal's instances, or what a type alias names. */
    const declaredType = (f: FileFacts, decl: number): Val => {
        const s = f.shapes.get(decl);
        if (s) return shaped(s, "instance", f);
        return f.flat.type[decl] === "type_alias_declaration" ? typeVal(f, child(f.flat, decl, "value")) : NONE;
    };
    /**
     * A declarator's declared type (its annotation, or in JavaScript its JSDoc) or its initializer as
     * written; an object literal; or an exported expression. A literal a type assertion or a call holds
     * (`{…} as T`, `make({…})`) is what TypeScript types the assertion or the call as.
     */
    const valueUnitVal = (f: FileFacts, u: Unit): Val => {
        const t = f.flat;
        if (t.type[u.node] === "variable_declarator") {
            if (child(t, u.node, "type") >= 0) return typeVal(f, annotatedType(t, u.node));
            const doc = f.docTypes ? variableDocType(t, u.node) : null;
            return doc !== null ? docTypeVal(f, doc, u.node) : evalExpr(f, child(t, u.node, "value"));
        }
        if (t.type[u.valueNode] === "object") {
            const holder = holderOf(t, u.valueNode);
            if (holder !== u.valueNode) return evalExpr(f, holder);
            const s = f.shapes.get(u.valueNode);
            return s ? shaped(s, "instance", f) : NONE;
        }
        return u.valueNode >= 0 ? evalExpr(f, u.valueNode) : NONE;
    };

    // Expressions.
    /** What an expression evaluates to, computed once per node. */
    const evalExpr = perNode("no expression", (f, n) => evaluate(f, n));
    const evaluate = (f: FileFacts, n: number): Val => {
        const t = f.flat;
        switch (t.type[n]) {
            case "identifier":
            case "shorthand_property_identifier": {
                const name = textOf(t, n);
                const b = lookup(scopeAt(f, n), name, VALUE | NS);
                if (b) return bindingVal(f, b);
                return name === "exports" ? moduleVal(f.path) : unknown(`global ${name}`);
            }
            case "this":
                return thisVal(f, n);
            case "parenthesized_expression":
            case "satisfies_expression":
            case "non_null_expression":
                return evalExpr(f, namedChildren(t, n)[0] ?? -1);
            // A type assertion types the value as TypeScript reads it: `x as T` names what x names, with T's members when the
            // read files declare T. A type outside them (`any`, a package's, a built-in) names no code here: x's own members
            // stand, the code that runs. One they can't resolve (a type parameter, `ReturnType<…>`) leaves the members unknown.
            case "as_expression":
            case "type_assertion": {
                const type = assertedType(t, n);
                const inner = evalExpr(f, namedChildren(t, n).find((c) => t.type[c] !== "type_arguments") ?? -1);
                if (type < 0) return inner;
                const asserted = typeVal(f, type);
                if (asserted.shapes.length > 0 || asserted.union || asserted.assigned || asserted.module) return { ...asserted, units: inner.units };
                return asserted.unknown && t.type[type] !== "predefined_type" ? { units: inner.units, shapes: [], unknown: asserted.unknown } : inner;
            }
            case "member_expression":
                return memberExpression(f, n);
            case "subscript_expression": {
                const idx = child(t, n, "index");
                if (t.type[idx] !== "string") return unknown("computed member");
                return memberOf(receiverVal(f, child(t, n, "object")), propName(t, idx)).next;
            }
            case "new_expression":
                return newExpression(f, n);
            case "call_expression":
                return callExpression(f, n);
            case "await_expression":
                return awaitExpression(f, n);
            case "assignment_expression": {
                const lhs = child(t, n, "left");
                if (t.type[lhs] === "member_expression" && propName(t, child(t, lhs, "property")) === "prototype") return evalExpr(f, lhs);
                return evalExpr(f, child(t, n, "right"));
            }
            case "ternary_expression":
                return merge(evalExpr(f, child(t, n, "consequence")), evalExpr(f, child(t, n, "alternative")));
            case "binary_expression":
                if (!tokensOf(t, n).some((x) => x === "||" || x === "??" || x === "&&")) return NONE;
                return merge(evalExpr(f, child(t, n, "left")), evalExpr(f, child(t, n, "right")));
            case "object":
                return literalVal(f, n, "instance");
            case "class":
            case "function_expression":
            case "function":
            case "arrow_function":
            case "generator_function":
                return literalVal(f, n, "static");
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
                return unknown(`expression ${t.type[n]}`);
        }
    };
    const memberExpression = (f: FileFacts, n: number): Val => {
        const t = f.flat;
        const obj = child(t, n, "object");
        const name = propName(t, child(t, n, "property"));
        if (t.type[obj] === "identifier" && textOf(t, obj) === "module" && !lookup(scopeAt(f, n), "module", VALUE) && name === "exports") return moduleVal(f.path);
        if (name === "prototype") return asSide(evalExpr(f, obj), "instance");
        return memberOf(receiverVal(f, obj), name).next;
    };
    const newExpression = (f: FileFacts, n: number): Val => {
        const t = f.flat;
        const ctor = child(t, n, "constructor");
        // A global constructor (Map, Error, URL...) never builds one of the read files' classes.
        if (t.type[ctor] === "identifier" && !lookup(scopeAt(f, n), textOf(t, ctor), VALUE)) return external(`new ${textOf(t, ctor)}`);
        const c = evalExpr(f, ctor);
        if (c.external) return external(c.external);
        if (c.unknown) return unknown(`new on ${c.unknown}`);
        return asSide(c, "instance");
    };
    /** A `require()`, a call that returns its first argument, or a result unknown. */
    const callExpression = (f: FileFacts, n: number): Val => {
        const t = f.flat;
        const spec = requireSpec(t, n, scopeAt(f, n));
        if (spec !== null) {
            const target = resolveModule(f.path, spec);
            return target.path ? moduleVal(target.path) : unknown(`external module '${spec}'`);
        }
        const fn = child(t, n, "function");
        const args = namedChildren(t, child(t, n, "arguments"));
        const name = fn >= 0 ? textOf(t, fn) : "";
        if (!RETURNS_FIRST.test(name) || args.length === 0) return unknown("call result");
        // `Object.assign(target, …sources)` is the target, naming what it names, with the sources' members over its own.
        const target = evalExpr(f, args[0]);
        if (!/assign$/i.test(name)) return target;
        return { units: target.units, shapes: [], assigned: args.map((a, i) => (i === 0 ? target : t.type[a] === "spread_element" ? unknown("a spread source") : evalExpr(f, a))) };
    };
    /** `await import('m')`: m's namespace. */
    const awaitExpression = (f: FileFacts, n: number): Val => {
        const t = f.flat;
        const inner = namedChildren(t, n)[0];
        if (inner !== undefined && t.type[inner] === "call_expression" && t.type[child(t, inner, "function")] === "import") {
            const first = namedChildren(t, child(t, inner, "arguments"))[0];
            const spec = first !== undefined && t.type[first] === "string" ? propName(t, first) : null;
            const target = spec ? resolveModule(f.path, spec).path : undefined;
            if (target) return namespace(target);
        }
        return unknown("awaited value");
    };
    /** An object, class or function literal: its unit when it is one's value, and its shape. */
    const literalVal = (f: FileFacts, n: number, side: Side): Val => {
        const u = unitOfValue(f, n);
        const s = f.shapes.get(n);
        return { units: u ? [u] : [], shapes: s ? [{ shape: s, side, file: f }] : [] };
    };
    const unitsByValue = new Map<FileFacts, Map<number, Unit>>();
    const unitOfValue = (f: FileFacts, node: number): Unit | undefined => {
        let m = unitsByValue.get(f);
        if (!m) unitsByValue.set(f, (m = new Map(f.units.filter((u) => u.valueNode >= 0).map((u) => [u.valueNode, u]))));
        return m.get(node);
    };

    /** The receiver of a member access: `super` is the base class, everything else evaluates. */
    const receiverVal = (f: FileFacts, obj: number): Val => {
        if (f.flat.type[obj] !== "super") return evalExpr(f, obj);
        const self = thisVal(f, obj);
        if (self.unknown) return self;
        const bases = self.shapes.flatMap((s) => s.shape.heritage.map((h) => ({ h, side: s.side, file: s.file })));
        if (bases.length === 0) return unknown("super without a base class");
        // super reads the base's prototype: not what a constructor assigns to `this`.
        return { ...merge(...bases.map((b) => asSide(evalExpr(b.file, b.h), b.side))), protoOnly: true };
    };

    /** In a Vue component, Vue binds the functions of its options to the component's instance, whatever object holds them: `this` there is unknown. */
    const optionsThis = (f: FileFacts): Val | null => (f.component?.framework === "vue" ? unknown("this in a component's options") : null);

    /** `this` at a node: the class instance, its static side, the object literal, or the constructor function's instance. */
    const thisVal = (f: FileFacts, node: number): Val => {
        const t = f.flat;
        /** The shape of a node, or unknown, why. */
        const shapeOr = (n: number, side: Side, why: string) => {
            const s = f.shapes.get(n);
            return s ? shaped(s, side, f) : unknown(why);
        };
        let prev = node;
        for (let a = t.parent[node]; a >= 0; prev = a, a = t.parent[a]) {
            const ty = t.type[a];
            if (ty === "public_field_definition" || ty === "field_definition") {
                if (t.field[prev] === "value") return shapeOr(classOfBody(t, t.parent[a]), hasToken(t, a, "static") ? "static" : "instance", "this in a field");
            } else if (ty === "class_static_block") return shapeOr(classOfBody(t, t.parent[a]), "static", "this in a static block");
            else if (ty === "method_definition") {
                const holder = t.parent[a];
                if (t.type[holder] === "object") return optionsThis(f) ?? shapeOr(holder, "instance", "this in an object method");
                return shapeOr(classOfBody(t, holder), hasToken(t, a, "static") ? "static" : "instance", "this in a method");
            } else if (ty === "function_declaration" || ty === "generator_function_declaration") return shapeOr(a, "instance", "this in a nested function");
            else if (FUNCTION_EXPRESSIONS.has(ty)) return functionThis(f, a);
            else if (ty === "class_body" || ty === "program") break;
        }
        return unknown("top-level this");
    };
    /** `this` in a function expression: an object literal's, or the instance of what it is assigned to. */
    const functionThis = (f: FileFacts, fn: number): Val => {
        const t = f.flat;
        let ctx = fn;
        while (t.type[t.parent[ctx]] === "parenthesized_expression") ctx = t.parent[ctx];
        const p = t.parent[ctx];
        if (t.type[p] === "pair") {
            const s = f.shapes.get(t.parent[p]);
            return optionsThis(f) ?? (s ? shaped(s, "instance", f) : unknown("this in an object function"));
        }
        const lhs = child(t, p, "left");
        if (t.type[p] === "assignment_expression" && t.field[ctx] === "right" && t.type[lhs] === "member_expression") {
            const obj = unwrap(t, child(t, lhs, "object"));
            // X.prototype.y = function, P.y = function (P = X.prototype): an instance of X. X.y = function: X itself.
            const owner = protoOwner(f, obj);
            return owner ? asSide(owner, "instance") : evalExpr(f, obj);
        }
        const s = t.type[p] === "variable_declarator" ? f.shapes.get(fn) : undefined;
        return s ? shaped(s, "instance", f) : unknown("this in a function expression");
    };
    /** For `X.prototype` or a prototype alias, X's value; else null. */
    const protoOwner = (f: FileFacts, obj: number): Val | null => {
        const t = f.flat;
        if (t.type[obj] === "identifier") {
            const owner = f.protoAliases.get(textOf(t, obj));
            const b = owner ? lookup(f.module, owner, VALUE) : null;
            return b ? bindingVal(f, b) : null;
        }
        if (t.type[obj] === "member_expression" && propName(t, child(t, obj, "property")) === "prototype") return evalExpr(f, unwrap(t, child(t, obj, "object")));
        return null;
    };

    // Types.
    /** What a type names: an instance of a class, an interface, a type literal; computed once per node. */
    const typeVal = perNode("no type", (f, n) => typeOf(f, n));
    const typeOf = (f: FileFacts, n: number): Val => {
        const t = f.flat;
        switch (t.type[n]) {
            case "type_annotation":
            case "parenthesized_type":
                return typeVal(f, namedChildren(t, n)[0] ?? -1);
            case "type_identifier": {
                const name = textOf(t, n);
                const b = lookup(scopeAt(f, n), name, TYPE);
                if (b) return asSide(bindingVal(f, b), "instance");
                // A global type: a built-in's members are no declaration here; a utility type's may be.
                return COMPUTED.has(name) || SAME_MEMBERS.has(name) ? unknown(`global type ${name}`) : external(`global type ${name}`);
            }
            case "generic_type":
                return genericType(f, n);
            case "nested_type_identifier": {
                // A namespace's or a module's member type; one not found where the namespace is known is no type known.
                const hit = memberOf(evalExpr(f, child(t, n, "module")), textOf(t, child(t, n, "name")));
                return hit.found === "no" && !hit.next.external ? unknown("namespace member type") : asSide(hit.next, "instance");
            }
            case "union_type": {
                const parts = flattenUnion(t, n).filter((c) => !/^(null|undefined|void)$/.test(textOf(t, c)));
                if (parts.length < 2) return parts.length === 0 ? NONE : typeVal(f, parts[0]);
                return { units: [], shapes: [], union: parts.map((c) => typeVal(f, c)) };
            }
            case "intersection_type":
                return intersect(...namedChildren(t, n).map((c) => typeVal(f, c)));
            case "object_type": {
                const s = f.shapes.get(n);
                return s ? shaped(s, "instance", f) : NONE;
            }
            case "type_query":
                return queryVal(f, namedChildren(t, n)[0] ?? -1);
            case "lookup_type": {
                // T["k"]: the type of member k of T.
                const [obj, idx] = namedChildren(t, n);
                const lit = idx !== undefined && t.type[idx] === "literal_type" ? namedChildren(t, idx)[0] : undefined;
                if (obj === undefined || lit === undefined || t.type[lit] !== "string") return unknown("indexed type");
                return memberOf(typeVal(f, obj), propName(t, lit)).next;
            }
            // `any` and `unknown` may be anything, so a value merged with one is unknown; other built-in types hold no declaration here.
            case "predefined_type":
                return /^(any|unknown)$/.test(textOf(t, n)) ? unknown(`type ${textOf(t, n)}`) : NONE;
            case "literal_type":
            case "function_type":
            case "constructor_type":
            case "array_type":
            case "tuple_type":
            case "template_literal_type":
                return NONE;
            default:
                return unknown(`type ${t.type[n]}`);
        }
    };
    /**
     * A JSDoc type, as TypeScript reads it in JavaScript: an instance of the class or constructor function
     * a name, a dotted name or `import('m').Name` gives, generic arguments aside, a union of such; anything
     * else (a type literal, a function type, a typedef, a built-in) unknown.
     */
    const docTypeVal = (f: FileFacts, type: string, at: number): Val => {
        const parts = docTypeParts(type).map((p) => docNameVal(f, p, at));
        return parts.length === 0 ? NONE : parts.length === 1 ? parts[0] : { units: [], shapes: [], union: parts };
    };
    const docNameVal = (f: FileFacts, part: string, at: number): Val => {
        const m = /^(?:import\(\s*(['"])([^'"]+)\1\s*\)\.)?([A-Za-z_$][\w$]*)((?:\.[A-Za-z_$][\w$]*)*)\s*(?:<.*>)?$/.exec(part);
        if (!m) return unknown("a JSDoc type");
        let v: Val;
        if (m[2] !== undefined) {
            const target = resolveModule(f.path, m[2]);
            if (!target.path) return unknown(`JSDoc type from '${m[2]}'`);
            v = memberOf(namespace(target.path), m[3]).next;
        } else {
            // A `@template` or `@typedef` of that name around it comes first: no class names it.
            if (templatesAt(f.flat, at).has(m[3]) || typedefAt(f.flat, at, m[3])) return unknown(`JSDoc template or typedef ${m[3]}`);
            const b = lookup(scopeAt(f, at), m[3], TYPE | VALUE | NS);
            if (!b) return unknown(`JSDoc type ${m[3]}`);
            v = bindingVal(f, b);
        }
        for (const name of m[4] ? m[4].slice(1).split(".") : []) v = memberOf(v, name).next;
        // Only a class or a constructor function names instances; a value used as a type is no type.
        return v.shapes.length > 0 && v.shapes.every((s) => hasSides(s.shape)) ? asSide(v, "instance") : unknown("JSDoc type naming no class");
    };

    /** What `typeof e` names: e's value; for `import("m")` and its members, the module the read files hold, a package's (outside them) else. */
    const queryVal = (f: FileFacts, q: number): Val => {
        const t = f.flat;
        let e = q;
        const keys: string[] = [];
        while (t.type[e] === "member_expression") {
            keys.unshift(propName(t, child(t, e, "property")));
            e = child(t, e, "object");
        }
        if (t.type[e] !== "call_expression" || t.type[child(t, e, "function")] !== "import") return evalExpr(f, q);
        const spec = firstStringArgument(t, e);
        if (spec === null) return unknown("import type");
        const { candidates, bare } = moduleCandidates(f.path, spec, config.paths(f.path));
        const path = firstThere(candidates);
        let v: Val = typeof path === "string" && byPath.has(path) ? namespace(path) : bare && path === null ? external(`package '${spec}'`) : unknown(`unread module '${spec}'`);
        for (const k of keys) v = memberOf(v, k).next;
        return v;
    };

    /** `G<A>`: a utility type that keeps its argument's members (`Partial<X>`), `InstanceType<typeof C>`, else G. */
    const genericType = (f: FileFacts, n: number): Val => {
        const t = f.flat;
        const name = child(t, n, "name");
        const nameText = name >= 0 ? textOf(t, name) : "";
        const first = namedChildren(t, child(t, n, "type_arguments"))[0];
        if (first !== undefined && !lookup(scopeAt(f, n), nameText, TYPE)) {
            if (SAME_MEMBERS.has(nameText)) return typeVal(f, first);
            if (nameText === "InstanceType" && t.type[first] === "type_query") return asSide(typeVal(f, first), "instance");
        }
        return typeVal(f, name);
    };

    // Members.
    const memberCache = new Map<Shape, Map<Side, Member[]>>();
    /** A shape's members on one side, with what module-level assignments give a class or constructor function; cached. */
    const membersOf = (s: Shape, side: Side, f: FileFacts): Member[] => {
        let bySide = memberCache.get(s);
        if (!bySide) memberCache.set(s, (bySide = new Map()));
        let list = bySide.get(side);
        if (!list) bySide.set(side, (list = sideMembers(s, side, f)));
        return list;
    };
    const sideMembers = (s: Shape, side: Side, f: FileFacts): Member[] => {
        if (!hasSides(s)) return s.members;
        const isStatic = side === "static";
        const assigned = f.assignments
            .filter((a) => a.owner === s.name && a.proto !== isStatic)
            .flatMap((a): Member[] => (a.name === "*" ? (f.shapes.get(a.value)?.members ?? []) : [{ name: a.name, static: isStatic, kind: "proto", ...(a.unit ? { unit: a.unit } : {}), value: a.value, typeNode: -1 }]));
        return [...s.members.filter((m) => m.static === isStatic), ...assigned];
    };

    /**
     * A member of a value by name. A write defines the member, so it never
     * follows an alias to what the member held. A member set only on some
     * paths (`if (x) this.emit = f`) beside one always set names only the one
     * always set. Of a getter and setter pair, a read names the getter, a
     * write the setter, an update both.
     */
    const memberOf = (v: Val, name: string, access: Access = "read", depth = 0, own = false): MemberHit => {
        if (depth > 8) return { units: [], next: unknown("deep inheritance"), found: "unknown", why: "deep inheritance" };
        // `Object.assign`'s result: the last argument that has the member; one that may (unknown, a spread) hides the earlier ones.
        // A source after the target lends only its own members, as `Object.assign` copies own properties; one from a package may lend any.
        if (v.assigned) {
            for (let i = v.assigned.length - 1; i >= 0; i--) {
                const source = v.assigned[i];
                if (i > 0 && source.external) return { units: [], next: unknown("a package's value"), found: "unknown", why: "a package's value" };
                const hit = memberOf(source, name, access, depth + 1, i > 0);
                if (hit.found !== "no") return hit;
            }
            return NOT_FOUND;
        }
        // A union type's member is the one declaration all its types name; TypeScript narrows the type where the reader can't see.
        if (v.union) {
            const hits = v.union.map((u) => memberOf(u, name, access, depth + 1, own));
            const one = hits[0].units.length === 1 ? hits[0].units[0] : undefined;
            if (one && hits.every((h) => h.found === "yes" && h.units.length === 1 && h.units[0] === one)) return { units: [one], next: merge(...hits.map((h) => h.next)), found: "yes" };
            return { units: [], next: unknown("member of a union type"), found: "unknown", why: "a union type" };
        }
        if (v.module) {
            const e = exportVal(v.module, name, new Set());
            if (e) return { units: e.units, next: e, found: e.unknown && e.units.length === 0 ? "unknown" : "yes", ...(e.unknown ? { why: e.unknown } : {}) };
            // Not a named export: the default export's members, when require() handed it back.
            if (v.shapes.length === 0) return NOT_FOUND;
        }
        if (v.shapes.length > 0) return shapesMember(v, name, access, depth, own);
        if (v.external) return { units: [], next: external(v.external), found: "no" };
        if (v.unknown) return { units: [], next: unknown(`member of ${v.unknown}`), found: "unknown", why: v.unknown };
        return NOT_FOUND;
    };
    /** Whether a member is an object's own enumerable property: any of a literal's; a class's or constructor's fields and `this.x`, statics assigned or declared as fields; not its prototype's methods and accessors. */
    const ownMember = (s: Shape, side: Side, m: Member): boolean =>
        !hasSides(s) || (side === "instance" ? m.kind === "field" || m.kind === "this" || m.kind === "param" : m.kind === "field" || m.kind === "proto");
    const shapesMember = (v: Val, name: string, access: Access, depth: number, own = false): MemberHit => {
        const units: Unit[] = [];
        const nexts: Val[] = [];
        let found = false;
        let open = false;
        let why = "";
        for (const { shape, side, file } of v.shapes) {
            if (name === "prototype" && side === "static" && hasSides(shape)) {
                nexts.push(shaped(shape, "instance", file));
                found = true;
                continue;
            }
            const hits = membersOf(shape, side, file).filter((m) => m.name === name && !(v.protoOnly && m.kind === "this") && (!own || ownMember(shape, side, m)));
            if (hits.length > 0) {
                found = true;
                const always = hits.some((m) => !m.conditional);
                const used = access === "read" ? hits.filter((m) => m.kind !== "set") : access === "write" ? hits.filter((m) => m.kind !== "get") : access === "delete" ? hits.filter((m) => m.kind !== "get" && m.kind !== "set") : hits;
                // A field declared with a type (`x: T`, or a JSDoc `@type` on `x;`) is what its type says, whatever is assigned to it, as TypeScript reads it.
                const declared = used.filter((m) => m.kind === "field" && (m.typeNode >= 0 || (file.docTypes && m.decl !== undefined && fieldDocType(file.flat, m.decl) !== null)));
                for (const m of declared.length > 0 ? declared : used) {
                    const value = memberValue(file, m);
                    nexts.push(m.unit && m.kind !== "get" && m.kind !== "set" ? { ...value, units: [m.unit] } : value);
                    if (m.conditional && always) continue;
                    if (m.unit) units.push(m.unit);
                    // An alias (`P.on = P.addListener`, `proto.emit = emitFn`) names what it points at.
                    if (access === "read" && !m.unit && (m.kind === "proto" || m.kind === "pair" || m.kind === "shorthand" || m.kind === "this" || m.kind === "field")) units.push(...value.units.filter((u) => u.kind === "function" || u.kind === "method"));
                }
                continue;
            }
            if (shape.open) open = true;
            // Inherited: the base class (or interface) on the same side.
            for (const h of shape.heritage) {
                const base = shape.kind === "interface" ? typeVal(file, h) : asSide(evalExpr(file, h), side);
                if (base.shapes.length === 0 && (base.unknown || base.external)) {
                    // A base from a package or a built-in holds no declaration here; an unknown one may hold the member.
                    if (!base.external) open = true;
                    why ||= `inherits from ${base.external ?? base.unknown}`;
                    continue;
                }
                const r = memberOf(base, name, access, depth + 1, own);
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
        // A branch of a merged value unknown or a package's may hold the member too: no one target is proven.
        if (found && v.uncertain) return { units: [], next: unknown(v.uncertain), found: "unknown", why: v.uncertain };
        if (found) return { units: [...new Set(units)], next: merge(...nexts), found: "yes" };
        if (open || v.unknown) return { units: [], next: unknown(why || "open object"), found: "unknown", why: why || v.unknown || "open object" };
        return NOT_FOUND;
    };
    /** A member's value, for chains like `this.cursor.reset()`. */
    const memberValue = (f: FileFacts, m: Member): Val => {
        // A method names itself. A read of an accessor is what the getter returns, never the getter: unknown without return types.
        if (m.kind === "get" || m.kind === "set") return unknown("what a getter returns");
        if (m.kind === "method" || m.kind === "signature") return m.unit ? { units: [m.unit], shapes: [] } : NONE;
        if (m.typeNode >= 0) return typeVal(f, m.typeNode);
        const doc = !f.docTypes || m.kind === "shorthand" ? null : m.value >= 0 ? memberDocType(f.flat, m.value) : m.decl !== undefined ? fieldDocType(f.flat, m.decl) : null;
        if (doc !== null) return docTypeVal(f, doc, m.value >= 0 ? m.value : m.decl!);
        // A field declared without a value holds nothing until it's assigned: its assignments say what it holds.
        if (m.kind === "field" && m.value < 0) return NONE;
        if (m.kind === "shorthand") {
            const b = lookup(scopeAt(f, m.value), textOf(f.flat, m.value), VALUE);
            return b ? bindingVal(f, b) : unknown("shorthand");
        }
        return m.value >= 0 ? evalExpr(f, m.value) : unknown("member without value");
    };

    return { byPath, resolveModule, importVal, moduleVal, exportVal, bindingVal, evalExpr, receiverVal, memberOf };
};

export type Evaluator = ReturnType<typeof createEvaluator>;
