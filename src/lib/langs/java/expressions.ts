/**
 * What a Java expression is: its static type, which tells overloads apart
 * (`exprType`), and what it is as a receiver (`exprVal`): a value of a type
 * read, a type, or a package. A name before `.` is a variable (a local, a
 * parameter, a field of a class around it, a static import's field), then
 * a type, then a package (JLS 6.5.2). Expressions and calls (`calls.ts`)
 * resolve each other: a call's receiver and arguments are expressions, and
 * a call is one.
 */

import type { GBinding, GScope } from "../../anyfacts.ts";
import { child, namedChildren, textOf } from "../../syntax.ts";
import { callOf, resultView } from "./calls.ts";
import { perNode, type JFile, type JType } from "./files.ts";
import { boundOf, fieldStatic, fieldType } from "./generics.ts";
import { fieldOf, type JField, type JMethod } from "./members.ts";
import { anonymousBody, code, dimsOf, namesOf, qualifiedCreation, typeParts } from "./nodes.ts";
import { classAround, inBody, scopeOf, typeParameterOf, variablesSeen } from "./scopes.ts";
import { bindingDims, staticType } from "./signatures.ts";
import { promote, promoted, refTo, sameType, UNTYPED, type SType } from "./static-types.ts";
import { fqnType, memberType, ownerOf, resolveParts, superclassOf, typeName, typeOfNode, type TypeRes } from "./type-names.ts";

/** What an expression is: a value of a type (null: not one read), a type, a package, or nothing sure. */
export type Val = { k: "value"; t: JType | null } | { k: "type"; res: TypeRes } | { k: "package"; name: string } | { k: "unknown" };
const UNSURE: Val = { k: "unknown" };

/** The class a value or a type is, where it is one read. */
export const typeOf = (v: Val): JType | null => (v.k === "value" ? v.t : v.k === "type" && v.res.k === "type" ? v.res.t : null);

const STRING: SType = { k: "ref", key: "java.lang.String" };
const BOOLEAN: SType = { k: "prim", name: "boolean" };

/** An expression's static type, where the code shows it: a literal, `this`, a creation, a cast, a variable's or a field's written type, a method's written result. */
export const exprType: (jf: JFile, e: number) => SType = perNode(UNTYPED, (jf, e) => {
    const t = jf.t;
    if (e < 0) return UNTYPED;
    const text = () => textOf(t, e);
    switch (t.type[e]) {
        case "decimal_integer_literal":
        case "hex_integer_literal":
        case "octal_integer_literal":
        case "binary_integer_literal":
            return { k: "prim", name: /[lL]$/.test(text()) ? "long" : "int" };
        case "decimal_floating_point_literal":
        case "hex_floating_point_literal":
            return { k: "prim", name: /[fF]$/.test(text()) ? "float" : "double" };
        case "character_literal":
            return { k: "prim", name: "char" };
        case "true":
        case "false":
        case "instanceof_expression":
            return BOOLEAN;
        case "string_literal":
            return STRING;
        case "null_literal":
            return { k: "null" };
        case "class_literal":
            return { k: "ref", key: "java.lang.Class" };
        case "lambda_expression": {
            const ps = child(t, e, "parameters");
            return { k: "fn", arity: ps < 0 ? 0 : t.type[ps] === "identifier" ? 1 : namedChildren(t, ps).filter((c) => t.type[c] === "identifier" || t.type[c] === "formal_parameter" || t.type[c] === "spread_parameter").length };
        }
        case "method_reference":
            return { k: "fn", arity: null };
        case "this": {
            const c = classAround(jf, e);
            return c ? refTo(c) : UNTYPED;
        }
        case "parenthesized_expression":
            return exprType(jf, code(t, e)[0] ?? -1);
        case "cast_expression": {
            const types = namedChildren(t, e).filter((c) => t.field[c] === "type");
            return types.length === 1 ? staticType(jf, types[0]) : UNTYPED;
        }
        case "object_creation_expression": {
            const body = anonymousBody(t, e);
            const anon = body !== undefined ? jf.byNode.get(body) : undefined;
            if (anon) return refTo(anon);
            return qualifiedCreation(t, e) ? UNTYPED : staticType(jf, child(t, e, "type"));
        }
        case "array_creation_expression":
            return staticType(jf, child(t, e, "type"), namedChildren(t, e).filter((c) => t.field[c] === "dimensions").reduce((n, c) => n + dimsOf(t, c), 0));
        case "identifier":
            return variableType(jf, e, text());
        case "field_access": {
            const obj = child(t, e, "object");
            const field = child(t, e, "field");
            if (t.type[field] === "this") {
                const q = exprVal(jf, obj);
                return q.k === "type" && q.res.k === "type" ? refTo(q.res.t) : UNTYPED;
            }
            const T = typeOf(t.type[obj] === "super" ? superVal(jf, obj) : exprVal(jf, obj));
            const fd = T ? fieldOf(T, textOf(t, field)) : { complete: false };
            const self = selfOf(jf, obj);
            return T && fd.found && fd.found !== "unknown" ? fieldStatic(self ?? T, fd.found, self !== null) : UNTYPED;
        }
        case "method_invocation": {
            const m = callOf(jf, child(t, e, "name"));
            if (!m || m.node < 0 || "fqn" in m.owner) return UNTYPED;
            const rt = child(m.owner.file.t, m.node, "type");
            const bound = resultView(jf, child(t, e, "name"), m, rt);
            return bound ? refTo(bound) : rt >= 0 ? staticType(m.owner.file, rt) : UNTYPED;
        }
        case "array_access": {
            const a = exprType(jf, child(t, e, "array"));
            return a.k === "array" ? a.elem : UNTYPED;
        }
        case "binary_expression": {
            const op = t.type[child(t, e, "operator")];
            if (["==", "!=", "<", ">", "<=", ">=", "&&", "||"].includes(op)) return BOOLEAN;
            const a = exprType(jf, child(t, e, "left"));
            const b = exprType(jf, child(t, e, "right"));
            if (op === "+" && ((a.k === "ref" && a.key === STRING.key) || (b.k === "ref" && b.key === STRING.key))) return STRING;
            return a.k === "prim" && b.k === "prim" ? promoted(a.name, b.name, op) : UNTYPED;
        }
        case "unary_expression": {
            const op = t.type[child(t, e, "operator")];
            if (op === "!") return BOOLEAN;
            const a = exprType(jf, child(t, e, "operand"));
            return a.k === "prim" && a.name !== "boolean" ? { k: "prim", name: promote(a.name) } : UNTYPED;
        }
        case "update_expression":
            return exprType(jf, code(t, e)[0] ?? -1);
        case "assignment_expression":
            return exprType(jf, child(t, e, "left"));
        case "ternary_expression": {
            const a = exprType(jf, child(t, e, "consequence"));
            const b = exprType(jf, child(t, e, "alternative"));
            return sameType(a, b) ? a : UNTYPED;
        }
        default:
            return UNTYPED;
    }
});

/** The variable a simple name means at a node: a local or a parameter bound once, a field of a class around it; "unsure" where that can't be told, "imports" where the static imports decide. */
type Variable = { k: "binding"; b: GBinding } | { k: "field"; T: JType; fd: JField | "unknown" } | { k: "unsure" } | { k: "imports" };

const variableAt = (jf: JFile, n: number, name: string): Variable => {
    const at = jf.t.start[n];
    for (let s: GScope | null = scopeOf(jf, n); s; s = s.parent) {
        const vs = variablesSeen(jf, s, name, at);
        if (vs.length > 0) return vs.length === 1 ? { k: "binding", b: vs[0] } : { k: "unsure" };
        if (s.kind === "class") {
            const T = jf.byNode.get(s.node);
            if (!T) return { k: "unsure" };
            if (!inBody(T, n)) continue;
            const fd = fieldOf(T, name);
            if (fd.found !== undefined) return { k: "field", T, fd: fd.found };
            if (!fd.complete) return { k: "unsure" };
        }
        if (s.kind === "module") break;
    }
    return { k: "imports" };
};

/** A name's static type where it is a variable: a local's or a parameter's written type (`var`: its value's), a field's. */
const variableType = (jf: JFile, n: number, name: string): SType => {
    const v = variableAt(jf, n, name);
    if (v.k === "binding") return v.b.typeNode !== undefined ? staticType(jf, v.b.typeNode, bindingDims(jf.t, v.b)) : v.b.init !== undefined ? exprType(jf, v.b.init) : UNTYPED;
    if (v.k === "field") return v.fd === "unknown" ? UNTYPED : fieldStatic(v.T, v.fd, true);
    if (v.k === "unsure") return UNTYPED;
    const sf = staticField(jf, name);
    return sf && sf !== "unknown" ? sf.static() : UNTYPED;
};

/** A name before `.` or `::`, as the JLS reclassifies it: a variable, a static import's field, a type, then a package. */
export const nameVal = (jf: JFile, n: number, name: string): Val => {
    const v = variableAt(jf, n, name);
    if (v.k === "binding") return { k: "value", t: typeOfBinding(jf, v.b) };
    if (v.k === "field") return { k: "value", t: v.fd === "unknown" ? null : fieldType(v.T, v.fd, true) };
    if (v.k === "unsure") return UNSURE;
    const sf = staticField(jf, name);
    if (sf === null) return UNSURE;
    if (sf !== undefined) return { k: "value", t: sf === "unknown" ? null : sf.type() };
    const res = typeName(jf, n, name);
    if (res.k === "none" && !res.fqn) return { k: "package", name };
    return res.k === "param" || res.k === "unknown" ? UNSURE : { k: "type", res };
};

/**
 * The field a static import gives a simple name: a single import's, which
 * shadows the rest, else the one an on-demand import gives, as code that
 * compiles has no second; undefined where none does, null where that
 * isn't known.
 */
const staticField = (jf: JFile, name: string): JField | "unknown" | null | undefined => {
    // A field that isn't static is no static import's: the name is then the import's method or member type.
    for (const i of jf.statics.filter((i) => i.local === name)) {
        const c = ownerOf(fqnType(jf, namesOf(i.spec), true));
        if (!c) return null;
        const fd = fieldOf(c, name);
        if (fd.found !== undefined && (fd.found === "unknown" || fd.found.isStatic)) return fd.found;
        if (!fd.complete) return null;
    }
    let found: JField | "unknown" | undefined;
    let known = true;
    for (const i of jf.staticStars) {
        const c = ownerOf(fqnType(jf, namesOf(i.spec), true));
        const fd = c ? fieldOf(c, name) : { complete: false };
        if (fd.found !== undefined && (fd.found === "unknown" || fd.found.isStatic)) {
            if (found !== undefined && found !== fd.found) return null;
            found = fd.found;
        } else if (!fd.complete) known = false;
    }
    return found ?? (known ? undefined : null);
};

const typeOfBinding = (jf: JFile, b: GBinding): JType | null => {
    if (b.typeNode !== undefined) {
        if (bindingDims(jf.t, b) > 0) return null;
        // A variable of a type variable's type, which is free where the variable is: the variable's bound's members.
        const t = jf.t;
        const tp = t.type[b.typeNode] === "type_identifier" ? typeParameterOf(jf, b.typeNode, textOf(t, b.typeNode)) : -1;
        return tp >= 0 ? boundOf(jf, tp) : typeOfNode(jf, b.typeNode);
    }
    if (b.init === undefined) return null;
    const v = exprVal(jf, b.init);
    return v.k === "value" ? v.t : null;
};

/** What an expression is as a receiver: a value of a type, a type, a package. */
export const exprVal: (jf: JFile, e: number) => Val = perNode(UNSURE, (jf, e) => {
    const t = jf.t;
    switch (t.type[e]) {
        case "this":
            return { k: "value", t: classAround(jf, e) };
        case "identifier":
            return nameVal(jf, e, textOf(t, e));
        case "type_identifier":
        case "generic_type":
        case "scoped_type_identifier":
            return { k: "type", res: resolveParts(jf, e, typeParts(t, e)) };
        case "parenthesized_expression":
            return exprVal(jf, code(t, e)[0] ?? -1);
        case "cast_expression": {
            const types = namedChildren(t, e).filter((c) => t.field[c] === "type");
            return types.length === 1 ? { k: "value", t: typeOfNode(jf, types[0]) } : UNSURE;
        }
        case "object_creation_expression": {
            const body = anonymousBody(t, e);
            if (body !== undefined) return { k: "value", t: jf.byNode.get(body) ?? null };
            return qualifiedCreation(t, e) ? UNSURE : { k: "value", t: typeOfNode(jf, child(t, e, "type")) };
        }
        case "field_access": {
            const obj = child(t, e, "object");
            const field = child(t, e, "field");
            // `Outer.this`.
            if (t.type[field] === "this") {
                const q = exprVal(jf, obj);
                return q.k === "type" && q.res.k === "type" ? { k: "value", t: q.res.t } : UNSURE;
            }
            return memberVal(jf, t.type[obj] === "super" ? superVal(jf, obj) : exprVal(jf, obj), textOf(t, field), selfOf(jf, obj));
        }
        case "method_invocation": {
            const m = callOf(jf, child(t, e, "name"));
            if (!m || m.node < 0 || "fqn" in m.owner) return UNSURE;
            // `Util.<Base>id(sub)`: the type argument written, not the argument's type.
            const i = child(t, e, "type_arguments") < 0 ? identityArg(m) : -1;
            if (i >= 0) {
                const v = exprVal(jf, code(t, child(t, e, "arguments"))[i] ?? -1);
                return v.k === "value" ? v : UNSURE;
            }
            const rt = child(m.owner.file.t, m.node, "type");
            const bound = resultView(jf, child(t, e, "name"), m, rt);
            return { k: "value", t: bound ?? (rt >= 0 ? typeOfNode(m.owner.file, rt) : null) };
        }
        default:
            return UNSURE;
    }
});

/**
 * `<T> T m(…, T x, …)`: the one parameter whose type is the method's own
 * type variable that it returns, where no other parameter names that
 * variable; -1 otherwise. A call that stands alone, as a receiver or a
 * `var`'s value, infers the variable from that argument alone.
 */
const identityArg = (m: JMethod): number => {
    if ("fqn" in m.owner || m.node < 0 || m.varargs) return -1;
    const t = m.owner.file.t;
    const rt = child(t, m.node, "type");
    if (rt < 0 || t.type[rt] !== "type_identifier") return -1;
    const name = textOf(t, rt);
    if (!namedChildren(t, child(t, m.node, "type_parameters")).some((tp) => namedChildren(t, tp).some((c) => t.type[c] === "type_identifier" && textOf(t, c) === name))) return -1;
    const names = (n: number): boolean => n >= 0 && ((t.type[n] === "type_identifier" && textOf(t, n) === name) || namedChildren(t, n).some(names));
    let at = -1;
    for (const [i, p] of namedChildren(t, child(t, m.node, "parameters")).filter((c) => t.type[c] === "formal_parameter").entries()) {
        const ty = child(t, p, "type");
        if (t.type[ty] === "type_identifier" && textOf(t, ty) === name && child(t, p, "dimensions") < 0) {
            if (at >= 0) return -1;
            at = i;
        } else if (names(ty)) return -1;
    }
    return at;
};

/** `super` in a class: its superclass, as a value. */
export const superVal = (jf: JFile, n: number): Val => {
    const c = classAround(jf, n);
    const s = c ? superclassOf(c) : null;
    return s && !("fqn" in s) ? { k: "value", t: s } : UNSURE;
};

/** `q.name`, given what q is: a field (its type), a member type, a package's type or subpackage; `self`, the class whose own instance q is (`this`, `super`, `Outer.this`). */
const memberVal = (jf: JFile, q: Val, name: string, self: JType | null): Val => {
    if (q.k === "package") {
        const res = fqnType(jf, [...q.name.split("."), name]);
        return res.k === "none" && !/^[A-Z]/.test(name) ? { k: "package", name: `${q.name}.${name}` } : res.k === "type" ? { k: "type", res } : UNSURE;
    }
    const T = typeOf(q);
    if (!T) return UNSURE;
    const fd = fieldOf(T, name);
    if (fd.found !== undefined) return { k: "value", t: fd.found === "unknown" ? null : fieldType(self ?? T, fd.found, self !== null) };
    if (!fd.complete || q.k !== "type") return UNSURE;
    // A type's member type: `Outer.Inner`.
    const m = memberType(T, name);
    return m.found !== undefined ? { k: "type", res: m.found } : UNSURE;
};

/** The class whose own instance a qualifier is: `this` and `super` the class around, `Outer.this` Outer; null for any other expression. */
export const selfOf = (jf: JFile, q: number): JType | null => {
    const t = jf.t;
    if (t.type[q] === "this" || t.type[q] === "super") return classAround(jf, q);
    if (t.type[q] !== "field_access" || t.type[child(t, q, "field")] !== "this") return null;
    const v = exprVal(jf, q);
    return v.k === "value" ? v.t : null;
};
