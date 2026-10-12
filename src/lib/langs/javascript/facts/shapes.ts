/**
 * Object shapes and their members: classes (declarations and expressions,
 * anywhere), interfaces and type literals, object literals, namespaces, and
 * the module's constructor functions, with what module-level assignments
 * (`X.prototype.y = v`, `P.y = v` where P is X.prototype, `X.y = v`,
 * `Object.assign(X, {...})`) give them.
 */

import { child, childOfType, hasToken, namedChildren, textOf, tokensOf, type Flat } from "../../../syntax.ts";
import type { Unit } from "../../pack.ts";
import type { FileFacts, Shape } from "../facts.ts";
import { annotatedType, fieldName, objectOf, propName, unwrap } from "./nodes.ts";

export type ShapeFacts = Pick<FileFacts, "shapes" | "protoAliases" | "assignments">;

const METHODS = new Set(["method_definition", "method_signature", "abstract_method_signature"]);
/** Where `this` is something else, so a walk for `this.x = v` stops. */
const CLASS_BOUNDS = new Set(["function_expression", "function_declaration", "generator_function", "generator_function_declaration", "class", "class_declaration", "function"]);
/** In a constructor function an object literal's method is a bound too. */
const FUNCTION_BOUNDS = new Set([...CLASS_BOUNDS, "method_definition"]);
/** Where an assignment runs only on some paths. */
const CONDITIONAL = new Set(["if_statement", "else_clause", "ternary_expression", "switch_case", "switch_default", "catch_clause", "for_statement", "for_in_statement", "while_statement", "do_statement"]);

const accessor = (t: Flat, n: number): "get" | "set" | undefined => (hasToken(t, n, "get") ? "get" : hasToken(t, n, "set") ? "set" : undefined);

/** Members a type literal or interface body declares; an index signature leaves the list open. */
const addTypeMembers = (t: Flat, body: number, shape: Shape) => {
    for (const m of namedChildren(t, body)) {
        const mt = t.type[m];
        if (mt === "index_signature") shape.open = true;
        if (mt !== "property_signature" && mt !== "method_signature") continue;
        const nm = child(t, m, "name");
        shape.members.push({ name: propName(t, nm), static: false, kind: mt === "method_signature" ? "signature" : "field", value: -1, typeNode: annotatedType(t, m) });
    }
};

/**
 * `this.x = v` under a root, not past a node in `bounds`. Inside a static
 * method `this` is the class itself; under a branch the member is only
 * sometimes set.
 */
const addThisAssignments = (t: Flat, root: number, shape: Shape, bounds: ReadonlySet<string>) => {
    const stack = [root];
    while (stack.length > 0) {
        const n = stack.pop()!;
        if (n !== root && bounds.has(t.type[n])) continue;
        for (let c = t.first[n]; c >= 0; c = t.next[c]) stack.push(c);
        const lhs = t.type[n] === "assignment_expression" ? child(t, n, "left") : -1;
        if (t.type[lhs] === "member_expression" && t.type[child(t, lhs, "object")] === "this") {
            const prop = child(t, lhs, "property");
            let isStatic = false;
            let conditional = false;
            for (let a = t.parent[n]; a >= 0 && a !== root; a = t.parent[a]) {
                const at = t.type[a];
                if (at === "method_definition") {
                    isStatic = hasToken(t, a, "static");
                    break;
                }
                if (CONDITIONAL.has(at) || (at === "binary_expression" && /^(&&|\|\||\?\?)$/.test(tokensOf(t, a)[0] ?? ""))) conditional = true;
            }
            shape.members.push({ name: propName(t, prop), static: isStatic, kind: "this", value: child(t, n, "right"), typeNode: -1, ...(conditional ? { conditional } : {}) });
        }
    }
};

export const shapesOf = (t: Flat, units: readonly Unit[]): ShapeFacts => {
    const unitByNode = new Map(units.map((u) => [u.node, u]));
    const unitByValue = new Map(units.filter((u) => u.valueNode >= 0).map((u) => [u.valueNode, u]));
    const memberUnit = (node: number, valueNode: number) => unitByNode.get(node) ?? (valueNode >= 0 ? unitByValue.get(valueNode) : undefined);
    const newShape = (name: string, kind: Shape["kind"]): Shape => ({ name, kind, members: [], heritage: [], open: false });

    const classMember = (shape: Shape, m: number) => {
        const mt = t.type[m];
        const isStatic = hasToken(t, m, "static");
        if (METHODS.has(mt)) {
            const nm = child(t, m, "name");
            const name = propName(t, nm);
            shape.members.push({ name, static: isStatic, kind: accessor(t, m) ?? (mt === "method_definition" ? "method" : "signature"), unit: memberUnit(m, m), value: m, typeNode: -1 });
            if (name === "constructor" && mt === "method_definition") parameterProperties(shape, m);
        } else if (mt === "public_field_definition" || mt === "field_definition") {
            const nm = fieldName(t, m);
            const v = child(t, m, "value");
            shape.members.push({ name: propName(t, nm), static: isStatic, kind: "field", unit: memberUnit(m, unwrap(t, v)), value: v, typeNode: annotatedType(t, m) });
        }
    };
    /** A constructor's `private x: T` and `readonly x: T` parameters: members of the instance. */
    const parameterProperties = (shape: Shape, ctor: number) => {
        for (const p of namedChildren(t, child(t, ctor, "parameters"))) {
            if (t.type[p] !== "required_parameter" && t.type[p] !== "optional_parameter") continue;
            if (childOfType(t, p, "accessibility_modifier") < 0 && !hasToken(t, p, "readonly")) continue;
            const pattern = child(t, p, "pattern");
            if (t.type[pattern] === "identifier") shape.members.push({ name: textOf(t, pattern), static: false, kind: "param", value: -1, typeNode: annotatedType(t, p) });
        }
    };
    const classShape = (n: number): Shape => {
        const nm = child(t, n, "name");
        const shape = newShape(nm >= 0 ? textOf(t, nm) : "default", "class");
        for (const h of namedChildren(t, childOfType(t, n, "class_heritage"))) {
            const base = t.type[h] === "extends_clause" ? child(t, h, "value") : t.type[h] === "implements_clause" ? -1 : h;
            if (base >= 0) shape.heritage.push(base);
        }
        const body = child(t, n, "body");
        if (body >= 0) {
            for (const m of namedChildren(t, body)) classMember(shape, m);
            // `this.x = v` anywhere in the class's own methods and field initializers.
            addThisAssignments(t, body, shape, CLASS_BOUNDS);
        }
        return shape;
    };
    const interfaceShape = (n: number): Shape => {
        const shape = newShape(textOf(t, child(t, n, "name")), "interface");
        shape.heritage.push(...namedChildren(t, childOfType(t, n, "extends_type_clause")));
        addTypeMembers(t, child(t, n, "body"), shape);
        return shape;
    };
    /** An object literal; a spread or a computed key leaves its member list open. */
    const objectShape = (n: number): Shape => {
        const shape = newShape("{}", "object");
        for (const p of namedChildren(t, n)) {
            const pt = t.type[p];
            if (pt === "method_definition") {
                const nm = child(t, p, "name");
                shape.members.push({ name: propName(t, nm), static: false, kind: accessor(t, p) ?? "method", unit: memberUnit(p, p), value: p, typeNode: -1 });
            } else if (pt === "pair") {
                const k = child(t, p, "key");
                const v = child(t, p, "value");
                if (t.type[k] === "computed_property_name") shape.open = true;
                else shape.members.push({ name: propName(t, k), static: false, kind: "pair", unit: memberUnit(p, unwrap(t, v)), value: v, typeNode: -1 });
            } else if (pt === "shorthand_property_identifier") {
                shape.members.push({ name: textOf(t, p), static: false, kind: "shorthand", value: p, typeNode: -1 });
            } else if (pt === "spread_element") shape.open = true;
        }
        return shape;
    };
    const shapeOf = (n: number): Shape | null => {
        switch (t.type[n]) {
            case "class_declaration":
            case "abstract_class_declaration":
            case "class":
                return classShape(n);
            case "interface_declaration":
                return interfaceShape(n);
            case "object_type": {
                const shape = newShape("{}", "interface");
                addTypeMembers(t, n, shape);
                return shape;
            }
            case "object":
                return objectShape(n);
            case "internal_module":
            case "module":
                return newShape(propName(t, child(t, n, "name")), "namespace");
            default:
                return null;
        }
    };

    const shapes = new Map<number, Shape>();
    for (let n = 0; n < t.count; n++) {
        const shape = shapeOf(n);
        if (shape) shapes.set(n, shape);
    }

    /** `X.prototype`, or `(X.prototype = {...})`: X's name. */
    const prototypeOf = (e: number): string | null => {
        e = unwrap(t, e);
        if (t.type[e] === "assignment_expression") return prototypeOf(child(t, e, "left"));
        if (t.type[e] !== "member_expression" || propName(t, child(t, e, "property")) !== "prototype") return null;
        const o = unwrap(t, child(t, e, "object"));
        return t.type[o] === "identifier" ? textOf(t, o) : null;
    };
    // `const P = X.prototype`: P's name to X's.
    const protoAliases = new Map<string, string>();
    for (const s of namedChildren(t, 0)) {
        if (t.type[s] !== "lexical_declaration" && t.type[s] !== "variable_declaration") continue;
        for (const d of namedChildren(t, s)) {
            if (t.type[d] !== "variable_declarator") continue;
            const nm = child(t, d, "name");
            const owner = prototypeOf(child(t, d, "value"));
            if (owner && t.type[nm] === "identifier") protoAliases.set(textOf(t, nm), owner);
        }
    }

    const assignments: FileFacts["assignments"] = [];
    const unitAt = (stmt: number, rhs: number) => unitByNode.get(stmt) ?? unitByValue.get(unwrap(t, rhs));
    /** `Object.assign(X, { a, b: v })`: static members of X. */
    const objectAssign = (call: number) => {
        const args = namedChildren(t, child(t, call, "arguments"));
        const target = unwrap(t, args[0] ?? -1);
        if (t.type[target] !== "identifier") return;
        const owner = textOf(t, target);
        for (const a of args.slice(1)) {
            const obj = unwrap(t, a);
            if (t.type[obj] !== "object") continue;
            for (const p of namedChildren(t, obj)) {
                const k = child(t, p, "key");
                if (t.type[p] === "shorthand_property_identifier") assignments.push({ owner, proto: false, name: textOf(t, p), value: p });
                else if (t.type[p] === "pair" && t.type[k] !== "computed_property_name") assignments.push({ owner, proto: false, name: propName(t, k), value: child(t, p, "value") });
            }
        }
    };
    /** `X.y = v` and `P.y = v`, `X.prototype.y = v`, and `X.prototype = {...}`, whose object's members join X's instances. */
    const memberAssignment = (s: number, e: number) => {
        const lhs = child(t, e, "left");
        const rhs = child(t, e, "right");
        if (t.type[lhs] !== "member_expression") return;
        const prop = child(t, lhs, "property");
        const name = propName(t, prop);
        const obj = unwrap(t, child(t, lhs, "object"));
        const add = (owner: string, proto: boolean) => assignments.push({ owner, proto, name, value: rhs, unit: unitAt(s, rhs) });
        if (t.type[obj] === "identifier") {
            const on = textOf(t, obj);
            if (name !== "prototype") add(protoAliases.get(on) ?? on, protoAliases.has(on));
            else {
                const o = objectOf(t, rhs);
                if (o >= 0) assignments.push({ owner: on, proto: true, name: "*", value: o });
            }
        } else if (t.type[obj] === "member_expression" && propName(t, child(t, obj, "property")) === "prototype") {
            const o = unwrap(t, child(t, obj, "object"));
            if (t.type[o] === "identifier") add(textOf(t, o), true);
        }
    };
    for (const s of namedChildren(t, 0)) {
        if (t.type[s] !== "expression_statement") continue;
        const e = namedChildren(t, s)[0];
        if (e === undefined) continue;
        if (t.type[e] === "call_expression" && /^Object(\.a|A)ssign$/.test(textOf(t, child(t, e, "function")))) objectAssign(e);
        else if (t.type[e] === "assignment_expression") memberAssignment(s, e);
    }

    // Module-level function declarations and function-valued consts may be constructors.
    for (const u of units) {
        if (u.parent || u.kind !== "function" || u.valueNode < 0) continue;
        const shape = newShape(u.name, "function");
        const body = child(t, u.valueNode, "body");
        if (body >= 0) addThisAssignments(t, body, shape, FUNCTION_BOUNDS);
        shapes.set(u.valueNode, shape);
    }
    return { shapes, protoAliases, assignments };
};
