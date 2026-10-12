/**
 * Java's resolver. Java's names don't follow the generic resolver's scopes,
 * so Java brings its own: the JLS's rules (chapters 4, 6, 8 and 15.12),
 * where the files read prove them for code that compiles. What they can't
 * prove names nothing, and so does a site in code the parser left a gap in
 * (`gaps.ts`). A type name goes through `type-names.ts`, a name before `.`
 * through `expressions.ts`, a call through `calls.ts`.
 */

import type { GSite, RefKind } from "../../anyfacts.ts";
import type { Named, OwnResolver } from "../../anylink.ts";
import { hasToken } from "../../syntax.ts";
import type { Unit } from "../pack.ts";
import { importable } from "./access.ts";
import { callOf, ctorOf, pick, receiverOf } from "./calls.ts";
import { exprVal, nameVal, selfOf, superVal, typeOf } from "./expressions.ts";
import { isIface, memberTypesOf, readFiles, type JFile, type JType } from "./files.ts";
import { unsureAt } from "./gaps.ts";
import { jdkPackage } from "./library.ts";
import { membersOf, methodsOf } from "./members.ts";
import { accessOf, anonymousBody, argCount, code, creationOf, dotted, isType, mayBeType, namesOf, qualifiedCreation, typeParts } from "./nodes.ts";
import { classAround } from "./scopes.ts";
import { fqnType, resolveParts, superclassOf, typeName } from "./type-names.ts";

const named = (u: Unit | undefined, ref: RefKind): Named => (u ? [{ ref, units: [u] }] : []);

/** An import's site: a single-type import names its type; `import static a.b.C.m;` every static member m that C declares and the file may use, each overload of m and a member type m. */
const importSite = (jf: JFile, s: GSite): Named => {
    const i = jf.f.imports.find((x) => x.node === s.node);
    if (!i) return [];
    if (jf.singles.includes(i)) {
        const r = fqnType(jf, [...namesOf(i.spec), s.name], true);
        return r.k === "type" ? named(r.t.unit, s.ref) : [];
    }
    const c = fqnType(jf, namesOf(i.spec), true);
    if (c.k !== "type") return [];
    const methods = membersOf(c.t).methods.get(s.name) ?? [];
    const type = memberTypesOf(c.t).get(s.name);
    const units = [...methods.filter((m) => m.isStatic && importable(jf, m)).map((m) => m.unit), ...(type && importable(jf, { access: accessOf(type.file.t, type.node, isIface(c.t)), owner: c.t }) ? [type.unit] : [])];
    const known = [...new Set(units.filter((u): u is Unit => u !== undefined))];
    return known.length > 0 ? [{ ref: s.ref, units: known }] : [];
};

/** `this(…)` and `super(…)`: a constructor of the class around, or of its superclass. */
const constructorCall = (jf: JFile, n: number): Named => {
    const t = jf.t;
    const call = t.parent[n];
    const c = classAround(jf, n);
    const target = c && t.type[n] === "super" ? superclassOf(c) : c;
    return target && !("fqn" in target) ? ctorOf(jf, n, target, argCount(t, call), t.type[n] === "super" ? "super" : "this", call) : [];
};

/** `x::m` names the one method m of x's type it may reach; `Foo::new` names the type, and the constructor when it has one. */
const methodReference = (jf: JFile, s: GSite): Named => {
    const t = jf.t;
    const n = s.node;
    const ref = t.parent[n];
    const parts = code(t, ref);
    if (parts.length > 1 && n === parts[parts.length - 1]) {
        const q = t.type[parts[0]] === "super" ? superVal(jf, parts[0]) : exprVal(jf, parts[0]);
        const T = typeOf(q);
        const self = selfOf(jf, parts[0]);
        return T ? named(pick(jf, n, T, methodsOf(T, s.name), null, receiverOf(q, self, T))?.unit, s.ref) : [];
    }
    const q = exprVal(jf, n);
    if (q.k !== "type" || q.res.k !== "type") return [];
    return [...named(q.res.t.unit, s.ref), ...(hasToken(t, ref, "new") ? ctorOf(jf, n, q.res.t, null, "ref").map((x) => ({ ...x, ref: s.ref })) : [])];
};

/** The class a site names as a type: a type's name or its last part after the qualifier's, `@a.b.Ann`, or a name before `.` that no variable has. */
const typeAt = (jf: JFile, s: GSite): JType | null => {
    const t = jf.t;
    const n = s.node;
    const p = t.parent[n];
    if (t.type[n] === "type_identifier") {
        const r = resolveParts(jf, n, typeParts(t, s.shape === "path" ? p : n));
        return r.k === "type" ? r.t : null;
    }
    if (s.shape === "path") {
        const r = resolveParts(jf, n, dotted(t, p));
        return r.k === "type" ? r.t : null;
    }
    if (!mayBeType(t, n)) return null;
    // A name before `.` names a type only when no variable has it: `state.read()` names the field state.
    const q = isType(t, n) ? ({ k: "type", res: typeName(jf, n, s.name) } as const) : nameVal(jf, n, s.name);
    return q.k === "type" && q.res.k === "type" ? q.res.t : null;
};

/** What a site names, and how. */
const resolveSite = (jf: JFile, s: GSite): Named => {
    const t = jf.t;
    const n = s.node;
    // A file of a JDK package (a stub) is no part of a build that has the JDK's.
    if (unsureAt(t, n) || jdkPackage(jf.pkg)) return [];
    if (s.ref === "import") return importSite(jf, s);
    if (t.type[n] === "this" || t.type[n] === "super") return constructorCall(jf, n);
    const p = t.parent[n];
    const pt = t.type[p];
    if (pt === "method_invocation" && t.field[n] === "name") return named(callOf(jf, n)?.unit, s.ref);
    if (pt === "method_reference") return methodReference(jf, s);
    // `Outer.Inner` in an expression: a member type, where no field has the name.
    if (pt === "field_access" && t.field[n] === "field") {
        const v = exprVal(jf, p);
        return v.k === "type" && v.res.k === "type" ? named(v.res.t.unit, s.ref) : [];
    }
    const creation = creationOf(t, n);
    if (creation >= 0 && qualifiedCreation(t, creation)) return [];
    const T = typeAt(jf, s);
    if (!T) return [];
    // `new Foo(…)`, an anonymous `new Foo(…) { … }` too: the type, and the constructor of Foo the arguments reach.
    return creation >= 0 ? [...named(T.unit, "type"), ...ctorOf(jf, n, T, argCount(t, creation), anonymousBody(t, creation) !== undefined ? "anonymous" : "new", creation)] : named(T.unit, s.ref);
};

const program: OwnResolver["program"] = (files, ctx) => {
    const jfileOf = readFiles(files, ctx);
    // A site reaches only a unit of its own name; `this(…)` and `super(…)` a constructor, a record component's name the record's implicit accessor.
    const names = new Set(["this", "super"]);
    for (const f of files) {
        for (const u of f.units) names.add(u.name);
        for (const T of jfileOf(f).byNode.values()) if (T.kind === "record") for (const name of membersOf(T).fields.keys()) names.add(name);
    }
    return (f, s) => (names.has(s.name) ? resolveSite(jfileOf(f), s) : []);
};

export const JAVA_RESOLVER: OwnResolver = { program };
