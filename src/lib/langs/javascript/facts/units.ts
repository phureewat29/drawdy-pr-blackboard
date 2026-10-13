/**
 * The declarations a card can stand for (units): module-level functions,
 * classes, types, values and namespaces; class members that are methods,
 * accessors or function-valued fields; methods of module-level object
 * literals; and `a.b = function` assignments. Functions nested in a function
 * body belong to the outer unit.
 */

import { child, childOfType, children, hasToken, lineOf, namedChildren, prevSibling, textOf, type Flat } from "../../../syntax.ts";
import type { Unit, UnitKind } from "../../pack.ts";
import { assignmentIn, fieldName, isFn, objectOf, propName, unwrap } from "./nodes.ts";

const OVERLOADABLE = new Set(["function_declaration", "generator_function_declaration", "function_signature", "method_definition", "method_signature", "abstract_method_signature"]);
const METHODS = new Set(["method_definition", "method_signature", "abstract_method_signature"]);
/** What an `export` statement holds besides the expression of `export = x`. */
const NOT_EXPORTED = new Set(["export_clause", "namespace_export", "string", "decorator"]);

/** `component`: a Vue or Svelte component's code, where a variable a call builds (`withDefaults(defineProps(), {...})`) is no object literal's, whatever object the call is given. */
export const unitsOf = (path: string, t: Flat, component = false): Unit[] => {
    const units: Unit[] = [];
    const qualified = (name: string, parent?: Unit) => (parent ? `${parent.qname}.${name}` : name);
    /** A keyword token of a node, or the node itself when it has none. */
    const keyword = (n: number, word: string) => children(t, n).find((c) => !t.named[c] && t.type[c] === word) ?? n;

    const statements = (container: number, parent?: Unit) => {
        for (const s of namedChildren(t, container)) statement(s, parent);
    };
    const statement = (s: number, parent?: Unit) => {
        if (t.type[s] !== "export_statement") return ambient(s, s, parent);
        const decl = child(t, s, "declaration");
        if (decl >= 0) return ambient(decl, s, parent);
        const value = child(t, s, "value");
        if (value >= 0) return exportDefault(s, value, parent);
        const e = namedChildren(t, s).find((c) => !NOT_EXPORTED.has(t.type[c]));
        if (e !== undefined && hasToken(t, s, "=")) defaultUnit(s, s, e, parent);
    };
    /** A declaration, `declare` unwrapped once; `declare global { ... }` is a namespace called global, as TypeScript reads it. */
    const ambient = (decl: number, outer: number, parent?: Unit) => {
        if (t.type[decl] !== "ambient_declaration") return declaration(decl, outer, parent);
        const block = childOfType(t, decl, "statement_block");
        if (hasToken(t, decl, "global") && block >= 0) return statements(block, addUnit(decl, outer, keyword(decl, "global"), "global", qualified("global", parent), "namespace", parent, decl));
        const inner = namedChildren(t, decl)[0];
        if (inner !== undefined) declaration(inner, outer, parent);
    };
    const declaration = (decl: number, outer: number, parent?: Unit) => {
        switch (t.type[decl]) {
            case "function_declaration":
            case "generator_function_declaration":
            case "function_signature":
                named(decl, outer, "function", parent);
                return;
            case "class_declaration":
            case "abstract_class_declaration":
                return classMembers(decl, named(decl, outer, "class", parent));
            case "interface_declaration":
            case "type_alias_declaration":
            case "enum_declaration": {
                const nm = child(t, decl, "name");
                addUnit(decl, outer, nm, textOf(t, nm), qualified(textOf(t, nm), parent), "type", parent, decl);
                return;
            }
            case "internal_module":
            case "module": {
                const nm = child(t, decl, "name");
                const name = propName(t, nm);
                const u = addUnit(decl, outer, nm, name, qualified(name, parent), "namespace", parent, decl);
                const body = child(t, decl, "body");
                if (body >= 0) statements(body, u);
                return;
            }
            case "lexical_declaration":
            case "variable_declaration":
                return variables(decl, outer, parent);
            case "expression_statement":
                return assignment(decl, outer, parent);
        }
    };

    /** A function or class declaration's unit, called `default` when it has no name. */
    const named = (decl: number, outer: number, kind: UnitKind, parent?: Unit): Unit => {
        const nm = child(t, decl, "name");
        const name = nm >= 0 ? textOf(t, nm) : "default";
        return addUnit(decl, outer, nm >= 0 ? nm : outer, name, qualified(name, parent), kind, parent, decl);
    };
    const exportDefault = (s: number, value: number, parent?: Unit) => {
        const e = unwrap(t, value);
        if (t.type[e] === "class") classMembers(e, addUnit(s, s, keyword(s, "default"), "default", qualified("default", parent), "class", parent, e));
        else defaultUnit(s, keyword(s, "default"), value, parent);
    };
    /** `export default <expr>` and `export = <expr>`: a unit called default, with the methods of an object literal it builds. A name exported this way has its own unit. */
    const defaultUnit = (s: number, nameNode: number, value: number, parent?: Unit) => {
        const e = unwrap(t, value);
        if (t.type[e] === "identifier") return;
        const u = addUnit(s, s, nameNode, "default", "default", isFn(t, e) ? "function" : "value", parent, e);
        const obj = objectOf(t, value);
        if (obj >= 0) objectMembers(obj, u, component);
    };
    /** Each declared variable: a class, a function, or a value with an object literal's methods. A statement declaring one variable is its unit whole. */
    const variables = (decl: number, outer: number, parent?: Unit) => {
        const declarators = namedChildren(t, decl).filter((c) => t.type[c] === "variable_declarator");
        for (const d of declarators) {
            const nm = child(t, d, "name");
            if (t.type[nm] !== "identifier") continue;
            const value = child(t, d, "value");
            const init = unwrap(t, value);
            const node = declarators.length === 1 ? outer : d;
            const name = textOf(t, nm);
            const qname = qualified(name, parent);
            if (t.type[init] === "class") classMembers(init, addUnit(d, node, nm, name, qname, "class", parent, init));
            else if (isFn(t, init)) addUnit(d, node, nm, name, qname, "function", parent, init);
            else {
                const obj = component && t.type[init] !== "object" ? -1 : objectOf(t, value);
                const u = addUnit(d, node, nm, name, qname, "value", parent, obj);
                if (obj >= 0) objectMembers(obj, u);
            }
        }
    };
    /** `a.b = function`, `a.b = class`, and the object literal of `module.exports = {...}`. */
    const assignment = (decl: number, outer: number, parent?: Unit) => {
        const e = assignmentIn(t, decl);
        if (e < 0) return;
        const lhs = child(t, e, "left");
        const right = child(t, e, "right");
        const rhs = unwrap(t, right);
        if (t.type[lhs] !== "member_expression" && t.type[lhs] !== "subscript_expression") return;
        const lhsText = textOf(t, lhs);
        const nameNode = t.type[lhs] === "member_expression" ? child(t, lhs, "property") : child(t, lhs, "index");
        const name = propName(t, nameNode);
        if (isFn(t, rhs)) addUnit(decl, outer, nameNode, name, lhsText, /^(module\.)?exports\./.test(lhsText) ? "function" : "method", parent, rhs);
        else if (t.type[rhs] === "class") classMembers(rhs, addUnit(decl, outer, nameNode, name, lhsText, "class", parent, rhs));
        else if (lhsText === "module.exports") {
            const obj = objectOf(t, right);
            if (obj >= 0) objectMembers(obj, addUnit(decl, outer, lhs, "module.exports", "module.exports", "value", parent, obj));
        }
    };

    const classMembers = (cls: number, parent: Unit) => {
        for (const m of namedChildren(t, child(t, cls, "body"))) {
            const ty = t.type[m];
            if (METHODS.has(ty)) method(m, memberStart(m), child(t, m, "name"), parent, m);
            if (ty !== "public_field_definition" && ty !== "field_definition") continue;
            const value = unwrap(t, child(t, m, "value"));
            if (isFn(t, value)) method(m, memberStart(m), fieldName(t, m), parent, value);
        }
    };
    /** `options`: a component's own, whose groups of functions (`methods: {…}`, `computed: {…}`) are units too, each holding its functions. */
    const objectMembers = (obj: number, parent: Unit, options = false) => {
        for (const p of namedChildren(t, obj)) {
            if (t.type[p] === "method_definition") method(p, p, child(t, p, "name"), parent, p);
            if (t.type[p] !== "pair") continue;
            const value = unwrap(t, child(t, p, "value"));
            if (isFn(t, value)) method(p, p, child(t, p, "key"), parent, value);
            else if (options && t.type[value] === "object") {
                const key = child(t, p, "key");
                const name = propName(t, key);
                objectMembers(value, addUnit(p, p, key, name, `${parent.qname}.${name}`, "value", parent, value));
            }
        }
    };
    const method = (node: number, outer: number, nameNode: number, parent: Unit, value: number) => {
        const name = propName(t, nameNode);
        addUnit(node, outer, nameNode, name, `${parent.qname}.${name}`, "method", parent, value);
    };
    /** A class member's first decorator: tree-sitter keeps decorators as the member's siblings. */
    const memberStart = (n: number): number => {
        let first = n;
        for (let p = prevSibling(t, n); p >= 0 && t.type[p] === "decorator"; p = prevSibling(t, p)) first = p;
        return first;
    };

    /** Overload signatures and their implementation are one unit; accessors are not overloads. */
    const overloadable = (n: number) => OVERLOADABLE.has(t.type[n]) && !hasToken(t, n, "get") && !hasToken(t, n, "set");
    /** Where the comments right above a node start; a blank line ends them. */
    const docStart = (n: number): number => {
        let first = t.start[n];
        for (let p = prevSibling(t, n); p >= 0 && t.type[p] === "comment"; p = prevSibling(t, p)) {
            if ((t.text.slice(t.end[p], first).match(/\n/g) ?? []).length > 1) break;
            first = t.start[p];
        }
        return first;
    };
    /** Adds a declaration's unit, from `outer`'s start, or grows the last unit when the declaration overloads it. */
    const addUnit = (node: number, outer: number, nameNode: number, name: string, qname: string, kind: UnitKind, parent: Unit | undefined, valueNode = -1): Unit => {
        const start = t.start[outer];
        // A decorated class member starts at its first decorator and ends with itself.
        const end = Math.max(t.end[outer], t.end[node]);
        const last = units[units.length - 1];
        if (last && last.name === name && last.parent === parent?.id && last.kind === kind && (kind === "function" || kind === "method") && overloadable(last.node) && overloadable(node)) {
            last.end = end;
            last.endLine = lineOf(t, Math.max(last.start, end - 1));
            last.node = node;
            if (valueNode >= 0) last.valueNode = valueNode;
            return last;
        }
        const nameStart = nameNode >= 0 ? t.start[nameNode] : start;
        const u: Unit = {
            id: "",
            path,
            name,
            qname,
            kind,
            start,
            end,
            startLine: lineOf(t, start),
            endLine: lineOf(t, Math.max(start, end - 1)),
            nameLine: lineOf(t, nameStart),
            docLine: lineOf(t, docStart(outer)),
            nameStart,
            ...(parent ? { parent: parent.id } : {}),
            node,
            valueNode,
        };
        // A second unit named on one line takes its name into its id.
        u.id = `${path}:${u.nameLine}`;
        if (units.some((x) => x.id === u.id)) u.id = `${path}:${u.nameLine}:${name}`;
        units.push(u);
        return u;
    };

    statements(0);
    return units;
};
