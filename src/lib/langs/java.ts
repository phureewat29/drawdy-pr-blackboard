/**
 * Java's rule table: tree-sitter-java 0.23.5's nodes, its own `tags.scm` for
 * classes, interfaces and methods, and the constructors, enums, records and
 * annotation types it leaves out. A local or anonymous class's members are
 * no card: they belong to the code around them.
 *
 * Java's names don't follow the generic resolver's scopes, so the table
 * brings its own (`program`): the JLS's rules (chapters 4, 6, 8 and 15.12),
 * where the files read prove them for code that compiles. What they can't
 * prove names nothing.
 * - A file's package clause, against its folders, gives its source root; a
 *   test root (`…/src/<set>/java`) also sees `…/src/main/java`. No other
 *   root: which modules a build puts beside the file, and so which copy of
 *   a class two modules declare, the files don't say. A package the JDK
 *   has (java.*, or one its modules export) is the JDK's whatever a root
 *   holds, and a file of one (a stub) names nothing.
 * - A simple type name is a type parameter, a local class, a member type of
 *   a class around it (declared or inherited), a type its file declares, a
 *   single-type import, a type of its package, then java.lang's once every
 *   root the file sees is known to lack it. An on-demand import proves
 *   nothing: its package's type loses to one of the file's own package that
 *   the reads may not see (another module's half of a split package, a
 *   second class in a file named for another).
 * - A class's header (its type parameters, supertypes and annotations)
 *   sees the names around the class, not its members; a record's
 *   components are the one exception.
 * - A name before `.` is a variable (a local, a parameter, a field of a
 *   class around it, a static import's field), then a type, then a package.
 *   A try-with-resources variable is in its block alone, not in the catch
 *   or finally after it.
 * - An unqualified call names a method of the innermost class around it
 *   with a member of that name, else a static import's.
 * - A member is declared or inherited. A supertype not read (outside the
 *   repository, or the JDK's that `jdk.ts` doesn't list) may hold any
 *   member: then only a class's own members are sure, and a call only with
 *   no argument, to a method nothing unseen replaces. So may a class whose
 *   text the parser left a gap in, or one Lombok writes members into.
 * - Of the methods or constructors a call may reach, the one its number of
 *   arguments, varargs counted, and their static types prove, as javac's
 *   three phases pick it. Overloads spread across a hierarchy count too, and
 *   a method overrides another where their parameter types erase alike. A
 *   parameter type with type arguments is a sure fit only for an argument
 *   of the type written alike, or where they are unbounded wildcards or the
 *   method's own type variables inference binds from that argument alone;
 *   a lone candidate the arguments' types rule out is no answer.
 * - A protected member of another package is reached only as JLS 6.6.2
 *   allows: through the subclass's own type, `this` or `super`; a protected
 *   constructor only through `super(…)` or an anonymous class.
 * - A type variable is what a subclass's supertype clauses bind it to. Its
 *   bound stands for it only on the class's own receiver (`this`, `super`,
 *   an unqualified name): an expression's type, read without its type
 *   arguments, gives no bound. `<T> T m(T x)` standing alone returns x's
 *   type, unless the call writes its type arguments.
 * - A site in a statement the parser left a gap in names nothing.
 *
 * The read tier reads what those lookups need, one file per name
 * (`javaWants`), in the roots a file sees: a changed file's single-type
 * and static imports' files and the names its package may declare beside
 * it; in the other files, the java.lang names a declaration's header writes,
 * to know the package holds none of them; and each class's supertypes,
 * round after round.
 */

import type { Emit, GBinding, GFile, GImport, GScope, GSite, LangRules, Role } from "../anyfacts.ts";
import type { ModuleContext, Named, OwnResolver } from "../anylink.ts";
import type { Unit } from "../facts.ts";
import { child, hasToken, namedChildren, textOf, type Flat } from "../syntax.ts";
import { JDK_ALIASES, JDK_EXPORTS, JDK_PACKAGES, JDK_TYPES } from "./jdk.ts";

/** A node's named children but comments, which tree-sitter puts wherever they're written: `f(a, // why\n b)` has two arguments. */
const code = (t: Flat, n: number) => namedChildren(t, n).filter((c) => t.type[c] !== "line_comment" && t.type[c] !== "block_comment");

/** Per tree: each node's last descendant (ids run in document order, a node before its children), and how many parse gaps come before each node. */
const gapCache = new WeakMap<Flat, { last: Int32Array; before: Int32Array; top: boolean }>();
const gapsOf = (t: Flat) => {
    let hit = gapCache.get(t);
    if (hit) return hit;
    const last = new Int32Array(t.count);
    for (let n = 0; n < t.count; n++) last[n] = n;
    for (let n = t.count - 1; n > 0; n--) if (last[t.parent[n]] < last[n]) last[t.parent[n]] = last[n];
    const before = new Int32Array(t.count + 1);
    for (let n = 0; n < t.count; n++) before[n + 1] = before[n] + (t.type[n] === "ERROR" || (n > 0 && t.start[n] === t.end[n]) ? 1 : 0);
    hit = { last, before, top: false };
    gapCache.set(t, hit);
    // A gap at the top, or in the package clause or an import, leaves the file's every name in doubt.
    for (let c = t.first[0]; c >= 0; c = t.next[c]) if (t.type[c] === "ERROR" || t.start[c] === t.end[c] || ((t.type[c] === "package_declaration" || t.type[c] === "import_declaration") && gapIn(t, c))) hit.top = true;
    return hit;
};
/**
 * Whether a node or one under it is a parse gap: an ERROR node, or a token
 * tree-sitter supplied (MISSING, of no width). What such code declares or
 * names may not be what it writes.
 */
const gapIn = (t: Flat, n: number): boolean => {
    if (n < 0) return false;
    const g = gapsOf(t);
    return g.before[g.last[n] + 1] - g.before[n] > 0;
};
/** Whether a type declaration's header (annotations, name, type parameters, supertypes, a record's components) holds a parse gap. */
const headerGap = (t: Flat, decl: number): boolean => {
    for (let c = t.first[decl]; c >= 0; c = t.next[c]) if (t.field[c] !== "body" && gapIn(t, c)) return true;
    return false;
};
const CLASS_BODIES = new Set(["class_body", "interface_body", "annotation_type_body", "enum_body", "enum_body_declarations"]);
/** Whether the code a node is in may not have parsed as written: a gap in the file's top, in a member around it, or in the header of a class around it. */
const unsureAt = (t: Flat, n: number): boolean => {
    if (gapsOf(t).top) return true;
    for (let x = n, p = t.parent[n]; p >= 0; x = p, p = t.parent[p]) {
        if (CLASS_BODIES.has(t.type[p]) && (TYPES.has(t.type[x]) ? headerGap(t, x) : gapIn(t, x))) return true;
        if (TYPES.has(t.type[p]) && t.field[x] !== "body" && headerGap(t, p)) return true;
    }
    return false;
};

const KINDS = { class_declaration: "class", interface_declaration: "interface", enum_declaration: "enum", record_declaration: "record", annotation_type_declaration: "annotation" } as const;
const TYPES: ReadonlySet<string> = new Set(Object.keys(KINDS));
const BODIES = new Set(["class_body", "interface_body", "annotation_type_body", "enum_body_declarations"]);
const CONSTRUCTORS = new Set(["constructor_declaration", "compact_constructor_declaration"]);

/** The type declaration a body belongs to, or -1: an anonymous class's body, an enum constant's. */
const ownerOfBody = (t: Flat, body: number): number => {
    let p = t.parent[body];
    if (t.type[body] === "enum_body_declarations" && p >= 0) p = t.parent[p];
    return p >= 0 && TYPES.has(t.type[p]) ? p : -1;
};

/** Whether a declaration is a top-level type or a member of one: a card can stand for it. */
const isMember = (t: Flat, n: number): boolean => {
    const p = t.parent[n];
    if (p < 0) return false;
    if (t.type[p] === "program") return true;
    if (!BODIES.has(t.type[p])) return false;
    const owner = ownerOfBody(t, p);
    return owner >= 0 && isMember(t, owner);
};

/** An anonymous class's body, or an enum constant's: a class of its own. */
const isAnonymousBody = (t: Flat, n: number) => t.type[n] === "class_body" && (t.type[t.parent[n]] === "object_creation_expression" || t.type[t.parent[n]] === "enum_constant");

const unit: LangRules["unit"] = (t, capture, node) => {
    const ty = t.type[node];
    const type = (capture === "definition.class" && ty === "class_declaration") || (capture === "definition.interface" && ty === "interface_declaration");
    if (!(type || (capture === "definition.method" && ty === "method_declaration")) || !isMember(t, node)) return null;
    return { kind: type ? "class" : "function", nameNode: child(t, node, "name"), outer: node };
};

/** `var x = …`: a type to infer, never one written. */
const isVar = (t: Flat, type: number) => type >= 0 && t.type[type] === "type_identifier" && textOf(t, type) === "var";

/** A varargs parameter's element type, `Foo` of `Foo... xs`. */
const spreadType = (t: Flat, n: number) => namedChildren(t, n).find((c) => t.type[c] !== "modifiers" && t.type[c] !== "variable_declarator" && t.type[c] !== "annotation" && t.type[c] !== "marker_annotation") ?? -1;

/** Whether a node sits in an arrow case's label, `case Foo f ->`, whose names are that case's alone. */
const inArrowCase = (t: Flat, n: number): boolean => {
    for (let x = t.parent[n]; x >= 0; x = t.parent[x]) {
        if (t.type[x] === "switch_label") return t.type[t.parent[x]] === "switch_rule";
        if (t.type[x] !== "pattern" && t.type[x] !== "type_pattern") return false;
    }
    return false;
};

const binds = (t: Flat, n: number, emit: Emit) => {
    const ty = t.type[n];
    if (TYPES.has(ty)) {
        // A local class is seen from its declaration to the end of its block.
        const p = t.type[t.parent[n]];
        emit(child(t, n, "name"), "type", { unitNode: n, ...(p === "program" || BODIES.has(p) ? {} : { from: t.start[n] }) });
        return;
    }
    switch (ty) {
        case "type_parameter": {
            const id = namedChildren(t, n).find((c) => t.type[c] === "type_identifier");
            if (id !== undefined) emit(id, "type");
            return;
        }
        // A variable's written type, its array dimensions read beside it (`String... xs`, `int x[]`).
        case "formal_parameter": {
            const name = child(t, n, "name");
            const type = child(t, n, "type");
            if (name >= 0 && t.type[name] === "identifier") emit(name, "param", isVar(t, type) ? {} : { typeNode: type });
            return;
        }
        case "spread_parameter": {
            const d = namedChildren(t, n).find((c) => t.type[c] === "variable_declarator");
            const name = d !== undefined ? child(t, d, "name") : -1;
            const type = spreadType(t, n);
            if (name >= 0 && t.type[name] === "identifier") emit(name, "param", type >= 0 ? { typeNode: type } : {});
            return;
        }
        case "catch_formal_parameter": {
            const name = child(t, n, "name");
            const types = code(t, namedChildren(t, n).find((c) => t.type[c] === "catch_type") ?? -1);
            if (name >= 0 && t.type[name] === "identifier") emit(name, "local", types.length === 1 ? { typeNode: types[0] } : {});
            return;
        }
        case "local_variable_declaration": {
            const type = child(t, n, "type");
            for (let c = t.first[n]; c >= 0; c = t.next[c]) {
                if (t.field[c] !== "declarator") continue;
                const name = child(t, c, "name");
                if (name < 0 || t.type[name] !== "identifier") continue;
                const value = child(t, c, "value");
                // In scope from its own declarator on.
                const typed = isVar(t, type) ? (value >= 0 ? { init: value } : {}) : { typeNode: type };
                emit(name, "local", { from: t.start[c], ...typed });
            }
            return;
        }
        case "enhanced_for_statement": {
            const name = child(t, n, "name");
            const type = child(t, n, "type");
            const body = child(t, n, "body");
            if (name >= 0 && t.type[name] === "identifier") emit(name, "local", { from: body >= 0 ? t.start[body] : t.end[n], ...(isVar(t, type) ? {} : { typeNode: type }) });
            return;
        }
        case "resource": {
            const name = child(t, n, "name");
            if (name < 0 || t.type[name] !== "identifier") return;
            const type = child(t, n, "type");
            emit(name, "local", { from: t.end[n], ...(isVar(t, type) ? { init: child(t, n, "value") } : { typeNode: type }) });
            return;
        }
        case "lambda_expression": {
            const ps = child(t, n, "parameters");
            if (ps >= 0 && t.type[ps] === "identifier") emit(ps, "param");
            else if (ps >= 0 && t.type[ps] === "inferred_parameters") for (const c of namedChildren(t, ps)) if (t.type[c] === "identifier") emit(c, "param");
            return;
        }
        // A pattern's variable is in scope as its condition flows: from the pattern to the end of its block, its name is a local of no known type.
        case "instanceof_expression": {
            const name = child(t, n, "name");
            if (name >= 0 && t.type[name] === "identifier") emit(name, "local", { from: t.start[n] });
            return;
        }
        case "type_pattern": {
            const id = namedChildren(t, n).find((c) => t.type[c] === "identifier");
            const type = code(t, n).find((c) => c !== id && t.type[c] !== "modifiers");
            if (id !== undefined) emit(id, "local", inArrowCase(t, n) && type !== undefined ? { typeNode: type } : { from: t.start[n] });
            return;
        }
        case "record_pattern_component": {
            const id = namedChildren(t, n).find((c) => t.type[c] === "identifier");
            if (id !== undefined) emit(id, "local", { from: t.start[n] });
            return;
        }
    }
};

/** Nodes whose `name` declares something: no use of it. */
const NAMED = new Set([
    ...TYPES,
    "method_declaration",
    "constructor_declaration",
    "compact_constructor_declaration",
    "annotation_type_element_declaration",
    "variable_declarator",
    "enum_constant",
    "formal_parameter",
    "catch_formal_parameter",
    "enhanced_for_statement",
    "resource",
    "instanceof_expression",
]);
/** Top-level declarations whose names are no code: the package clause, imports (they make sites of their own), a module's. */
const NO_CODE = new Set(["package_declaration", "import_declaration", "module_declaration"]);

/** The top-level node holding a node. */
const topOf = (t: Flat, n: number): number => {
    let x = n;
    while (t.parent[x] > 0) x = t.parent[x];
    return x;
};

const role = (t: Flat, n: number): Role => {
    const p = t.parent[n];
    if (p < 0) return { kind: "skip" };
    const pt = t.type[p];
    const f = t.field[n];
    const ty = t.type[n];
    // `this(…)` and `super(…)` call a constructor; any other `this` or `super` is a receiver.
    if (ty === "this" || ty === "super") return pt === "explicit_constructor_invocation" && f === "constructor" ? { kind: "bare", expr: n } : { kind: "skip" };
    if (f === "name" && NAMED.has(pt)) return { kind: "decl" };
    if (NO_CODE.has(t.type[topOf(t, n)]) || isVar(t, n)) return { kind: "skip" };
    if (ty === "identifier" && (pt === "labeled_statement" || pt === "break_statement" || pt === "continue_statement")) return { kind: "skip" };
    if (pt === "element_value_pair" && f === "key") return { kind: "skip" };
    // `case RED:` names a constant of the switch's own type.
    if (pt === "switch_label" && ty === "identifier") return { kind: "skip" };
    if (pt === "method_invocation" && f === "name") {
        // `X.super.m()`: the receiver is the `super` written after X.
        const sup = namedChildren(t, p).find((c) => t.type[c] === "super" && t.field[c] !== "object");
        const obj = child(t, p, "object");
        return sup !== undefined ? { kind: "member", receiver: sup, expr: n } : obj >= 0 ? { kind: "member", receiver: obj, expr: n } : { kind: "bare", expr: n };
    }
    if (pt === "field_access" && f === "field") return { kind: "member", receiver: child(t, p, "object"), expr: n };
    if (pt === "method_reference") {
        const parts = code(t, p);
        return parts.length > 1 && n === parts[parts.length - 1] ? { kind: "member", receiver: parts[0], expr: n } : { kind: "bare", expr: n };
    }
    if (pt === "scoped_type_identifier") {
        const parts = code(t, p).filter((c) => t.type[c] !== "annotation" && t.type[c] !== "marker_annotation");
        return parts.length > 1 && n === parts[parts.length - 1] ? { kind: "path", receiver: parts[0], expr: n } : { kind: "bare", expr: n };
    }
    // `@a.b.Ann`.
    if (pt === "scoped_identifier" && f === "name") return { kind: "path", receiver: child(t, p, "scope"), expr: n };
    return { kind: "bare", expr: n };
};

/** A creation's body, when it makes an anonymous class: `new T(…) { … }` extends T rather than calls it. */
const anonymousBody = (t: Flat, creation: number) => namedChildren(t, creation).find((c) => t.type[c] === "class_body");

/** `outer.new Inner()`: the type is a member of outer's class, never a name in scope. */
const qualifiedCreation = (t: Flat, creation: number) => code(t, creation).some((c) => t.field[c] === "" && t.type[c] !== "class_body" && t.type[c] !== "annotation" && t.type[c] !== "marker_annotation");

/** The creation a type name is the class of, `new Foo()`, `new a.b.Foo()`, `new Foo<>()`, or -1. */
const creationOf = (t: Flat, n: number): number => {
    let x = n;
    let q = t.parent[n];
    if (q >= 0 && t.type[q] === "scoped_type_identifier") {
        const parts = code(t, q);
        if (x !== parts[parts.length - 1]) return -1;
        x = q;
        q = t.parent[q];
    }
    if (q >= 0 && t.type[q] === "generic_type") {
        x = q;
        q = t.parent[q];
    }
    return q >= 0 && t.type[q] === "object_creation_expression" && t.field[x] === "type" ? q : -1;
};

const isCallee = (t: Flat, e: number): boolean => {
    const p = t.parent[e];
    if (p < 0) return false;
    const pt = t.type[p];
    if (pt === "method_invocation") return t.field[e] === "name";
    if (pt === "explicit_constructor_invocation") return t.field[e] === "constructor";
    // `new Foo()` names the type and calls its constructor (the resolver says both); a method reference `Foo::bar` is a value, called later if at all.
    const creation = creationOf(t, e);
    return creation >= 0 && anonymousBody(t, creation) === undefined;
};

const isType = (t: Flat, n: number) => t.type[n] === "type_identifier" || t.type[t.parent[n]] === "marker_annotation" || t.type[t.parent[n]] === "annotation" || t.type[t.parent[n]] === "record_pattern";

/** A dotted spec's names: `a.b` gives [a, b], "" none. */
const namesOf = (spec: string): string[] => (spec ? spec.split(".") : []);

/** A dotted name's parts: `a.b.C`. */
const dotted = (t: Flat, n: number): string[] => (n < 0 ? [] : t.type[n] === "scoped_identifier" ? [...dotted(t, child(t, n, "scope")), textOf(t, child(t, n, "name"))] : [textOf(t, n)]);

const importsOf = (t: Flat): GImport[] => {
    const out: GImport[] = [];
    for (const n of namedChildren(t, 0)) {
        if (t.type[n] !== "import_declaration") continue;
        const path = namedChildren(t, n).find((c) => t.type[c] === "scoped_identifier" || t.type[c] === "identifier");
        if (path === undefined) continue;
        const segs = dotted(t, path);
        if (namedChildren(t, n).some((c) => t.type[c] === "asterisk")) {
            out.push({ local: "", spec: segs.join("."), level: 0, name: "*", node: -1, bind: -1, stmt: n });
            continue;
        }
        const last = t.type[path] === "scoped_identifier" ? child(t, path, "name") : path;
        out.push({ local: segs[segs.length - 1], spec: segs.slice(0, -1).join("."), level: 0, name: segs[segs.length - 1], node: last, bind: last, stmt: n });
    }
    return out;
};

const importCache = new WeakMap<Flat, GImport[]>();
const imports = (t: Flat) => {
    let hit = importCache.get(t);
    if (!hit) importCache.set(t, (hit = importsOf(t)));
    return hit;
};

const KEYWORD: Record<string, string> = { class_declaration: "class", interface_declaration: "interface", enum_declaration: "enum", record_declaration: "record", annotation_type_declaration: "@interface" };

export const JAVA: LangRules = {
    unit,
    extraUnits: (t) => {
        const out: { kind: "class" | "function"; nameNode: number; outer: number; node: number }[] = [];
        for (let n = 0; n < t.count; n++) {
            const ty = t.type[n];
            const kind = ty === "enum_declaration" || ty === "record_declaration" || ty === "annotation_type_declaration" ? "class" : CONSTRUCTORS.has(ty) || ty === "annotation_type_element_declaration" ? "function" : null;
            if (kind && isMember(t, n)) out.push({ kind, nameNode: child(t, n, "name"), outer: n, node: n });
        }
        return out;
    },
    // `class Foo`, `Foo.run()`, a constructor `Foo()`.
    label: (t, u, parent) => {
        const ty = t.type[u.node];
        if (KEYWORD[ty]) return `${KEYWORD[ty]} ${u.name}`;
        return CONSTRUCTORS.has(ty) || !parent ? `${u.name}()` : `${parent.name}.${u.name}()`;
    },
    scope: (t, n) => {
        const ty = t.type[n];
        if (TYPES.has(ty) || isAnonymousBody(t, n)) return "class";
        if (ty === "method_declaration" || CONSTRUCTORS.has(ty) || ty === "lambda_expression") return "function";
        // An old-style switch is one block: a local of one group is seen in the next.
        if (ty === "block" || ty === "switch_block" || ty === "switch_rule" || ty === "for_statement" || ty === "enhanced_for_statement" || ty === "catch_clause" || ty === "try_with_resources_statement") return "block";
        return null;
    },
    binds,
    identifiers: new Set(["identifier", "type_identifier", "this", "super"]),
    role,
    isCallee,
    isType,
    imports,
};

/** The package a file's clause names; "" for the default package. */
const packageOf = (t: Flat): string => {
    const pd = namedChildren(t, 0).find((c) => t.type[c] === "package_declaration");
    const name = pd !== undefined ? namedChildren(t, pd).find((c) => t.type[c] === "scoped_identifier" || t.type[c] === "identifier") : undefined;
    return name !== undefined ? dotted(t, name).join(".") : "";
};

/** The folder a file's package starts in: its own folder less the package's folders, or null when they differ. */
const rootOf = (path: string, pkg: string): string | null => {
    const dir = path.split("/").slice(0, -1);
    const segs = pkg ? pkg.split(".") : [];
    if (segs.length > dir.length) return null;
    for (let i = 0; i < segs.length; i++) if (dir[dir.length - segs.length + i] !== segs[i]) return null;
    return dir.slice(0, dir.length - segs.length).join("/");
};

const SOURCE_SET = /^(.*\/)?src\/([^/]+)\/java$/;
/**
 * The roots a file's package and imports are read in, its own first: a test
 * root (`…/src/<set>/java`, any set but main) also sees `…/src/main/java`.
 * Another module's root is never one: which modules a build puts on the
 * classpath, and whether an unread one declares the same name, the reads
 * can't tell.
 */
const rootsSeen = (root: string): string[] => {
    const m = SOURCE_SET.exec(root);
    return m && m[2] !== "main" ? [root, `${m[1] ?? ""}src/main/java`] : [root];
};

const at = (root: string, rel: string) => (root ? `${root}/${rel}` : rel);

/** Where a type named by its parts lies: its package, its top-level type (the first part written with a capital, Java's convention for types) and that type's file, then the names nested in it. */
const typeFile = (segs: readonly string[]): { pkg: string; top: string; rel: string; nested: string[] } | null => {
    if (segs.length === 0) return null;
    let i = segs.findIndex((s) => /^[A-Z]/.test(s));
    if (i < 0) i = segs.length - 1;
    return { pkg: segs.slice(0, i).join("."), top: segs[i], rel: [...segs.slice(0, i), `${segs[i]}.java`].join("/"), nested: segs.slice(i + 1) };
};

/**
 * java.lang's types since Java 8: one of these names is java.lang's once
 * every root the file sees is known to hold no type of the name in its
 * package.
 */
const JAVA_LANG = new Set(
    "AbstractMethodError Appendable ArithmeticException ArrayIndexOutOfBoundsException ArrayStoreException AssertionError AutoCloseable Boolean BootstrapMethodError Byte Character CharSequence Class ClassCastException ClassCircularityError ClassFormatError ClassLoader ClassNotFoundException ClassValue CloneNotSupportedException Cloneable Comparable Deprecated Double Enum EnumConstantNotPresentException Error Exception ExceptionInInitializerError Float FunctionalInterface IllegalAccessError IllegalAccessException IllegalArgumentException IllegalCallerException IllegalMonitorStateException IllegalStateException IllegalThreadStateException IncompatibleClassChangeError IndexOutOfBoundsException InheritableThreadLocal InstantiationError InstantiationException Integer InternalError InterruptedException Iterable LayerInstantiationException LinkageError Long Math NegativeArraySizeException NoClassDefFoundError NoSuchFieldError NoSuchFieldException NoSuchMethodError NoSuchMethodException NullPointerException Number NumberFormatException Object OutOfMemoryError Override Readable ReflectiveOperationException Runnable Runtime RuntimeException SafeVarargs SecurityException Short StackOverflowError StackTraceElement StackWalker StrictMath String StringBuffer StringBuilder StringIndexOutOfBoundsException SuppressWarnings System Thread ThreadDeath ThreadGroup ThreadLocal Throwable TypeNotPresentException UnknownError UnsatisfiedLinkError UnsupportedClassVersionError UnsupportedOperationException VerifyError VirtualMachineError Void".split(" ")
);

type Access = "public" | "protected" | "package" | "private";

/** A JDK type, as far as names need it: its members and what it extends. */
type Lib = {
    fqn: string;
    iface: boolean;
    supers: readonly string[];
    /** Whether its members are listed: false for a type the table holds for its supertypes alone. */
    members: boolean;
    /** `params`: each parameter's type as written in the table, a varargs one as its array (`java.lang.String[]`), a type variable `?`. */
    methods: readonly { name: string; n: number; varargs: boolean; access: Access; isStatic: boolean; abstract: boolean; key: string | null; params: readonly string[] }[];
    fields: ReadonlySet<string>;
    types: ReadonlySet<string>;
};

/** A line of `JDK_TYPES`. */
const libOf = (line: string): Lib => {
    const [fqn, kind, supers, methods, fields, types] = line
        .replace(/!([0-9a-z]+)/g, (_, n: string) => JDK_ALIASES[parseInt(n, 36)])
        .replace(/@([0-9a-z]+)\./g, (_, n: string) => `${JDK_PACKAGES[parseInt(n, 36)]}.`)
        .split("|");
    return {
        fqn,
        iface: kind.toLowerCase() === "i",
        supers: supers ? supers.split(",") : [],
        members: kind === "i" || kind === "c",
        methods: (methods ? methods.split(" ") : []).map((m) => {
            const flags = m.split(":");
            const sig = flags.pop()!;
            const list = sig.slice(sig.indexOf("(") + 1, -1);
            const varargs = list.endsWith("...");
            const written = list ? list.replace(/\.\.\.$/, "").split(",") : [];
            const params = written.map((p, i) => (varargs && i === written.length - 1 && p !== "?" ? `${p}[]` : p));
            const key = params.includes("?") ? null : params.join(",");
            return { name: sig.slice(0, sig.indexOf("(")), n: params.length, varargs, access: flags.includes("p") ? "protected" : "public", isStatic: flags.includes("s"), abstract: flags.includes("a"), key, params };
        }),
        fields: new Set(fields ? fields.split(" ") : []),
        types: new Set(types ? types.split(" ") : []),
    };
};

/** The JDK's types known, by name (`java.util.Map.Entry`), read from `JDK_TYPES` once. */
let libs: ReadonlyMap<string, Lib> | null = null;
const libNamed = (fqn: string): Lib | undefined => (libs ??= new Map(JDK_TYPES.split("\n").map((line) => { const l = libOf(line); return [l.fqn, l]; }))).get(fqn);
const OBJECT = () => libNamed("java.lang.Object")!;

/**
 * Whether a package is the JDK's: java.* or one its modules export
 * (`JDK_EXPORTS`). A build takes such a package's types from the JDK
 * whatever a source root holds (netty's stubs of `com.sun.nio.sctp`).
 */
let exportsSet: ReadonlySet<string> | null = null;
const jdkPackage = (pkg: string) =>
    /^java(\.|$)/.test(pkg) ||
    (exportsSet ??= new Set(
        JDK_EXPORTS.split("\n").flatMap((line) => {
            const [around, names] = line.split("|");
            return names.split(" ").map((n) => `${around}.${n}`);
        })
    )).has(pkg);

let interfaceObject: Lib | null = null;
/** What an interface with no superinterface declares: Object's public methods, abstract (JLS 9.2). */
const INTERFACE_OBJECT = (): Lib => (interfaceObject ??= { ...OBJECT(), iface: true, methods: OBJECT().methods.filter((m) => m.access === "public").map((m) => ({ ...m, abstract: true })) });

/** What a file is to Java: its package and root, its imports by kind, the type names it declares. */
type Outline = {
    pkg: string;
    root: string | null;
    /** `import a.b.C;` */
    singles: GImport[];
    /** `import static a.b.C.m;` */
    statics: GImport[];
    /** `import static a.b.C.*;` */
    staticStars: GImport[];
    /** Every class-like declaration's name, local and nested ones too. */
    declared: ReadonlySet<string>;
    /** Its top-level types' names. */
    tops: ReadonlySet<string>;
    /** Every type parameter's name. */
    params: ReadonlySet<string>;
    /** Whether it uses Lombok, which writes members into its classes (`@Getter`, `@Data`, `@Builder`). */
    lombok: boolean;
};

const outlines = new WeakMap<Flat, Outline>();
const outlineOf = (f: GFile): Outline => {
    const t = f.flat;
    let hit = outlines.get(t);
    if (hit) return hit;
    const pkg = packageOf(t);
    const isStatic = (i: GImport) => hasToken(t, i.stmt, "static");
    const declared = new Set<string>();
    const tops = new Set<string>();
    const params = new Set<string>();
    for (let n = 0; n < t.count; n++) {
        if (TYPES.has(t.type[n])) {
            declared.add(textOf(t, child(t, n, "name")));
            if (t.parent[n] === 0) tops.add(textOf(t, child(t, n, "name")));
        } else if (t.type[n] === "type_parameter") for (const c of namedChildren(t, n)) if (t.type[c] === "type_identifier") params.add(textOf(t, c));
    }
    hit = {
        pkg,
        root: rootOf(f.path, pkg),
        singles: f.imports.filter((i) => i.name !== "*" && !isStatic(i)),
        statics: f.imports.filter((i) => i.name !== "*" && isStatic(i)),
        staticStars: f.imports.filter((i) => i.name === "*" && isStatic(i)),
        declared,
        tops,
        params,
        lombok: f.imports.some((i) => i.spec === "lombok" || i.spec.startsWith("lombok.")) || t.text.includes("@lombok."),
    };
    outlines.set(t, hit);
    return hit;
};

/** A type node's name as written, without its type arguments or annotations: `a.b.Foo` gives `[a, b, Foo]`; [] for a primitive, an array, `var`. */
const typeParts = (t: Flat, n: number): string[] => {
    if (n < 0) return [];
    switch (t.type[n]) {
        case "type_identifier":
            return isVar(t, n) ? [] : [textOf(t, n)];
        case "generic_type":
            return typeParts(t, namedChildren(t, n)[0] ?? -1);
        case "annotated_type":
            return typeParts(t, namedChildren(t, n).find((c) => t.type[c] !== "annotation" && t.type[c] !== "marker_annotation") ?? -1);
        case "scoped_type_identifier": {
            const parts = code(t, n).filter((c) => t.type[c] !== "annotation" && t.type[c] !== "marker_annotation");
            const head = typeParts(t, parts[0] ?? -1);
            return parts.length > 1 && head.length > 0 ? [...head, textOf(t, parts[parts.length - 1])] : [];
        }
        default:
            return [];
    }
};

/** The supertypes a declaration writes, `extends` and `implements`; an anonymous class's base. */
const supertypeNodes = (t: Flat, n: number): number[] => {
    if (t.type[n] === "class_body") {
        const creation = t.parent[n];
        return t.type[creation] === "object_creation_expression" && child(t, creation, "type") >= 0 ? [child(t, creation, "type")] : [];
    }
    const out: number[] = [];
    const sup = child(t, n, "superclass");
    if (sup >= 0) out.push(...code(t, sup));
    for (const l of [child(t, n, "interfaces"), namedChildren(t, n).find((c) => t.type[c] === "extends_interfaces") ?? -1]) {
        if (l >= 0) for (const tl of namedChildren(t, l)) if (t.type[tl] === "type_list") out.push(...code(t, tl));
    }
    return out;
};

/** Whether a site may name a type: a type's name, an annotation's, a record pattern's, or a name `.` or `::` follows. */
const mayBeType = (t: Flat, n: number): boolean => {
    if (t.type[n] === "type_identifier") return true;
    const p = t.parent[n];
    const pt = t.type[p];
    if ((pt === "marker_annotation" || pt === "annotation") && t.field[n] === "name") return true;
    if (pt === "record_pattern" || ((pt === "method_invocation" || pt === "field_access") && t.field[n] === "object")) return true;
    return pt === "method_reference" && code(t, p)[0] === n;
};

/** The bodies whose code runs: what a declaration's header (its types, parameters, bounds) never holds. */
const BODY_BLOCKS = new Set(["block", "constructor_body", "lambda_expression", "static_initializer"]);

/**
 * The files the board needs for Java's names, given what the reads found
 * so far: for a changed file, its imports' files and the names it uses that
 * its package may declare beside it; for every file read, its classes'
 * supertypes, and the java.lang names its declarations' headers write
 * (`String`, `Error`), which its package may declare too. A type is looked
 * for in the roots the file sees, its own first; the JDK's packages nowhere.
 */
export const javaWants = (files: readonly GFile[], ctx: ModuleContext, changed: (path: string) => boolean): string[] => {
    const out: string[] = [];
    const asked = new Set<string>();
    const want = (p: string) => {
        if (!asked.has(p)) out.push(p);
        asked.add(p);
    };
    /** A type's file, relative to a root: in the roots seen, the first not known to lack it. */
    const look = (own: readonly string[], rel: string, pkg: string) => {
        if (/^javax?\./.test(`${pkg}.`) || jdkPackage(pkg)) return;
        for (const r of own) {
            if (ctx.exists?.(at(r, rel)) === false) continue;
            return want(at(r, rel));
        }
    };
    const lookFqn = (own: readonly string[], segs: readonly string[]) => {
        const tf = typeFile(segs);
        if (tf) look(own, tf.rel, tf.pkg);
    };
    for (const f of files) {
        const o = outlineOf(f);
        // A file of a JDK package names nothing (see `program`): nothing to read for it.
        if (o.root === null || jdkPackage(o.pkg)) continue;
        const own = rootsSeen(o.root);
        const pkgDir = o.pkg ? o.pkg.split(".") : [];
        const besides = (name: string) => look(own, [...pkgDir, `${name}.java`].join("/"), o.pkg);
        const imported = new Map<string, GImport>();
        for (const i of [...o.singles, ...o.statics]) imported.set(i.local, i);
        const t = f.flat;
        /** A type this file writes, by its parts, where the names in `declared` aren't its own: the file its first name leads to. */
        const lookType = (segs: readonly string[], declared: ReadonlySet<string>) => {
            const [first] = segs;
            if (!first || declared.has(first) || o.params.has(first)) return;
            const i = imported.get(first);
            if (i) return lookFqn(own, [...namesOf(i.spec), ...(o.singles.includes(i) ? [first] : [])]);
            if (/^[A-Z]/.test(first)) return besides(first);
            if (segs.length > 1) lookFqn(own, segs);
        };
        const isChanged = changed(f.path);
        if (isChanged) {
            for (const i of o.singles) lookFqn(own, [...namesOf(i.spec), i.local]);
            for (const i of [...o.statics, ...o.staticStars]) lookFqn(own, namesOf(i.spec));
            for (const s of f.sites) {
                if (s.shape !== "bare" || !/^[A-Z]/.test(s.name) || !mayBeType(t, s.node)) continue;
                if (!o.declared.has(s.name) && !o.params.has(s.name) && !imported.has(s.name)) besides(s.name);
            }
            // A qualified type, `a.b.Foo` or `Outer.Inner`.
            for (let n = 0; n < t.count; n++) if (t.type[n] === "scoped_type_identifier" && t.type[t.parent[n]] !== "scoped_type_identifier") lookType(typeParts(t, n), o.declared);
        } else {
            // The java.lang names a declaration's header writes, outside the code its bodies run.
            for (let n = 0; n < t.count; n++) {
                if (t.type[n] !== "type_identifier" || !JAVA_LANG.has(textOf(t, n)) || o.declared.has(textOf(t, n)) || imported.has(textOf(t, n))) continue;
                let x = t.parent[n];
                while (x > 0 && !BODY_BLOCKS.has(t.type[x])) x = t.parent[x];
                if (x <= 0) besides(textOf(t, n));
            }
        }
        // A class's supertypes, written where its members, and so a nested type of its own, aren't in scope.
        for (let n = 0; n < t.count; n++) if (TYPES.has(t.type[n]) || (isChanged && t.type[n] === "class_body" && t.type[t.parent[n]] === "object_creation_expression")) for (const s of supertypeNodes(t, n)) lookType(typeParts(t, s), o.tops);
    }
    return out;
};

/**
 * A static type, as far as overloads need it: a primitive, null, a reference
 * type by key (its name with its package's; a local or anonymous class's
 * `#id`), an array, a type
 * variable, a lambda's or a method reference's (`fn`, its parameters' number
 * if a lambda's), or one not known.
 */
type SType = { k: "prim"; name: string } | { k: "null" } | { k: "ref"; key: string; type?: JType | Lib; args?: true; targs?: string } | { k: "array"; elem: SType } | { k: "var" } | { k: "fn"; arity: number | null } | { k: "unknown" };
const UNTYPED: SType = { k: "unknown" };
type Fit = "yes" | "no" | "maybe";

/** Each primitive's widening conversions (JLS 5.1.2). */
const WIDENING: Record<string, string[]> = {
    byte: ["short", "int", "long", "float", "double"],
    short: ["int", "long", "float", "double"],
    char: ["int", "long", "float", "double"],
    int: ["long", "float", "double"],
    long: ["float", "double"],
    float: ["double"],
};
const BOXES: Record<string, string> = { int: "java.lang.Integer", long: "java.lang.Long", short: "java.lang.Short", byte: "java.lang.Byte", char: "java.lang.Character", boolean: "java.lang.Boolean", float: "java.lang.Float", double: "java.lang.Double" };
const UNBOXED: Record<string, string> = Object.fromEntries(Object.entries(BOXES).map(([prim, box]) => [box, prim]));
const PRIMITIVES = new Set(Object.keys(BOXES));

const NO_VARS: ReadonlySet<string> = new Set();
const isAnnotation = (t: Flat, n: number) => t.type[n] === "annotation" || t.type[n] === "marker_annotation";

/**
 * Whether a type node writes type arguments that constrain it (`List<String>`,
 * `Map<K, ? extends V>`), which its erasure alone can't compare. An unbounded
 * wildcard constrains nothing (`Class<?>`), nor does one of `lone`, a
 * method's type variable that inference binds from this argument alone
 * (`<T> T fromJson(String json, Class<T> c)` takes any `Class`).
 */
const constrained = (t: Flat, n: number, lone: ReadonlySet<string> = NO_VARS): boolean => {
    const last = gapsOf(t).last[n];
    for (let x = n; x <= last; x++) {
        if (t.type[x] !== "type_arguments") continue;
        if (code(t, x).some((c) => (t.type[c] === "wildcard" ? code(t, c).some((b) => !isAnnotation(t, b)) : t.type[c] !== "type_identifier" || !lone.has(textOf(t, c))))) return true;
    }
    return false;
};

/**
 * A method's or a constructor's type variables written with no bound that
 * appear once among its parameters' types: inference binds such a variable
 * from that argument alone, whatever its type arguments are (JLS 18.5.1).
 */
const loneVars = (t: Flat, decl: number, params: readonly number[]): ReadonlySet<string> => {
    const tps = child(t, decl, "type_parameters");
    if (tps < 0) return NO_VARS;
    const free = new Set<string>();
    for (const tp of code(t, tps)) {
        const parts = code(t, tp).filter((c) => !isAnnotation(t, c));
        if (t.type[tp] === "type_parameter" && parts.length === 1 && t.type[parts[0]] === "type_identifier") free.add(textOf(t, parts[0]));
    }
    if (free.size === 0) return NO_VARS;
    const seen = new Map<string, number>();
    for (const p of params) {
        const last = gapsOf(t).last[p];
        for (let x = p; x <= last; x++) if (t.type[x] === "type_identifier" && free.has(textOf(t, x))) seen.set(textOf(t, x), (seen.get(textOf(t, x)) ?? 0) + 1);
    }
    return new Set([...free].filter((v) => seen.get(v) === 1));
};

/** A type as the JDK table writes it: a primitive, a type variable `?`, an array `T[]`, else a type's name. */
const libParam = (p: string): SType => (p === "?" ? { k: "var" } : p.endsWith("[]") ? { k: "array", elem: libParam(p.slice(0, -2)) } : PRIMITIVES.has(p) ? { k: "prim", name: p } : { k: "ref", key: p });

const sameType = (a: SType, b: SType): boolean =>
    a.k === b.k && (a.k === "prim" ? a.name === (b as typeof a).name : a.k === "ref" ? a.key === (b as typeof a).key : a.k === "array" ? sameType(a.elem, (b as typeof a).elem) : a.k === "null");

/** Unary numeric promotion. */
const promote = (prim: string) => (prim === "byte" || prim === "short" || prim === "char" ? "int" : prim);
/** A binary operator's result on two primitives: a shift takes its left operand's promoted type, else binary numeric promotion; booleans give a boolean. */
const promoted = (a: string, b: string, op: string): SType => {
    if (a === "boolean" || b === "boolean") return a === b && ["&", "|", "^"].includes(op) ? { k: "prim", name: "boolean" } : UNTYPED;
    if (op === "<<" || op === ">>" || op === ">>>") return { k: "prim", name: promote(a) };
    for (const wide of ["double", "float", "long"]) if (a === wide || b === wide) return { k: "prim", name: wide };
    return { k: "prim", name: "int" };
};

/** A class-like declaration of a file read: named (top-level, a member, local) or anonymous (`new T() { … }`, an enum constant's body). */
type JType = {
    id: number;
    file: JFile;
    /** The declaration, or an anonymous class's body: the node that opens its scope. */
    node: number;
    name: string;
    kind: "class" | "interface" | "enum" | "record" | "annotation" | "anonymous" | "constant";
    /** The class it is written in. */
    outer: JType | null;
    unit: Unit | undefined;
};

type JFile = Outline & { f: GFile; t: Flat; byNode: Map<number, JType>; top: Map<string, JType> };

/** A method or constructor: declared, implicit (`values()`, a record's accessor), or a JDK type's. */
type JMethod = {
    name: string;
    owner: JType | Lib;
    /** Its declaration, or -1. */
    node: number;
    unit: Unit | undefined;
    n: number;
    varargs: boolean;
    isStatic: boolean;
    abstract: boolean;
    access: Access;
    /** Its parameter types (`org.x.Box,int,java.lang.String`, a local class as `#id`), or null where one of them can't be told apart from other types. */
    key: () => string | null;
    /** Its parameters' static types, a varargs one as its array. */
    params: () => SType[];
};

/** A field: its type, and where that is a type variable of the class declaring it, the variable's name, which a subclass's supertype clause may bind. */
type JField = { owner: JType | Lib; access: Access; isStatic: boolean; type: () => JType | null; static: () => SType; typeVar: () => string | null };

type Members = { methods: Map<string, JMethod[]>; ctors: JMethod[]; fields: Map<string, JField>; types: Map<string, JType> };

/** What a type name means: a type read, a JDK type known, a type parameter, nothing sure, or nothing (`fqn`: an import's, outside the repository). */
type TypeRes = { k: "type"; t: JType } | { k: "lib"; lib: Lib } | { k: "param" } | { k: "unknown" } | { k: "none"; fqn?: string };
const UNKNOWN: TypeRes = { k: "unknown" };
const NONE: TypeRes = { k: "none" };

/** What an expression is: a value of a type (null: not one read), a type, a package, or nothing sure. */
type Val = { k: "value"; t: JType | null } | { k: "type"; res: TypeRes } | { k: "package"; name: string } | { k: "unknown" };
const UNSURE: Val = { k: "unknown" };

/**
 * Whether a class's members aren't all as written: Lombok writes some (its
 * file uses `lombok`), or a parse gap in its header or a member's
 * declaration may hide one or change its parameters (`Class<?> @Nullable
 * ... types` doesn't parse in tree-sitter-java 0.23.5).
 */
const openCache = new WeakMap<JType, boolean>();
const openOf = (T: JType): boolean => {
    let hit = openCache.get(T);
    if (hit !== undefined) return hit;
    hit = T.file.lombok;
    const t = T.file.t;
    const anonymous = T.kind === "anonymous" || T.kind === "constant";
    if (!anonymous && headerGap(t, T.node)) hit = true;
    const body = anonymous ? T.node : child(t, T.node, "body");
    for (let c = body >= 0 ? t.first[body] : -1; c >= 0 && !hit; c = t.next[c]) {
        for (const m of t.type[c] === "enum_body_declarations" ? namedChildren(t, c) : [c]) {
            if (t.type[m] === "ERROR" || t.start[m] === t.end[m]) hit = true;
            else if (TYPES.has(t.type[m])) hit ||= headerGap(t, m);
            else if (t.type[m] !== "block" && t.type[m] !== "static_initializer") hit ||= headerGap(t, m);
        }
    }
    openCache.set(T, hit);
    return hit;
};

const modifiersOf = (t: Flat, decl: number) => namedChildren(t, decl).find((c) => t.type[c] === "modifiers") ?? -1;
const has = (t: Flat, decl: number, word: string) => {
    const mods = modifiersOf(t, decl);
    return mods >= 0 && hasToken(t, mods, word);
};
/** A declaration's access: what it writes, else an interface member's public, else the package's. */
const accessOf = (t: Flat, decl: number, inInterface: boolean): Access =>
    has(t, decl, "private") ? "private" : has(t, decl, "protected") ? "protected" : inInterface || has(t, decl, "public") ? "public" : "package";

const lazy = <V>(make: () => V): (() => V) => {
    let done = false;
    let value: V;
    return () => {
        if (!done) {
            value = make();
            done = true;
        }
        return value;
    };
};

/** Java's resolver over the Java files read. */
const program: OwnResolver["program"] = (files, ctx) => {
    const known = new Set(ctx.known);
    const exists = (p: string): boolean | undefined => (ctx.exists ? ctx.exists(p) : known.has(p) ? true : undefined);
    const byPath = new Map(files.map((f) => [f.path, f]));
    let ids = 0;
    const jfiles = new Map<GFile, JFile>();
    const jfileOf = (f: GFile): JFile => {
        let hit = jfiles.get(f);
        if (hit) return hit;
        const t = f.flat;
        hit = { ...outlineOf(f), f, t, byNode: new Map(), top: new Map() };
        jfiles.set(f, hit);
        for (let n = 0; n < t.count; n++) {
            const named = TYPES.has(t.type[n]);
            if (!named && !isAnonymousBody(t, n)) continue;
            let outer: JType | null = null;
            for (let x = t.parent[n]; x >= 0 && !outer; x = t.parent[x]) outer = hit.byNode.get(x) ?? null;
            const kind = named ? KINDS[t.type[n] as keyof typeof KINDS] : t.type[t.parent[n]] === "enum_constant" ? "constant" : "anonymous";
            const jt: JType = { id: ids++, file: hit, node: n, name: named ? textOf(t, child(t, n, "name")) : "", kind, outer, unit: named ? f.unitByNode.get(n) : undefined };
            hit.byNode.set(n, jt);
            if (named && t.parent[n] === 0) hit.top.set(jt.name, jt);
        }
        return hit;
    };
    const isIface = (x: JType | Lib) => ("fqn" in x ? x.iface : x.kind === "interface" || x.kind === "annotation");
    /** A type's key, the same whichever file names it: its name with its package's (`org.x.Outer.Inner`); a local or anonymous class's id. */
    const typeKey = (T: JType): string => {
        if (!isMember(T.file.t, T.node)) return `#${T.id}`;
        const names: string[] = [];
        for (let x: JType | null = T; x; x = x.outer) names.unshift(x.name);
        return [...(T.file.pkg ? [T.file.pkg] : []), ...names].join(".");
    };
    const pkgOf = (x: JType | Lib) => ("fqn" in x ? x.fqn.slice(0, x.fqn.lastIndexOf(".")) : x.file.pkg);

    /** Top-level type `name` of package `pkg` in the file at `path`: absent (a 404, or a file that doesn't declare it), or unknown (never asked, or too long to read). */
    const topAt = (path: string, pkg: string, name: string): JType | "absent" | "unknown" => {
        if (exists(path) === false) return "absent";
        const f = byPath.get(path);
        if (!f) return "unknown";
        const jf = jfileOf(f);
        return jf.pkg === pkg ? (jf.top.get(name) ?? "absent") : "absent";
    };
    /** A top-level type as a file sees it: in the roots it sees, its own first; absent when they all lack it (another module's, a library's, or none). */
    const typeIn = (from: JFile, pkg: string, name: string, rel: string): JType | "absent" | "unknown" => {
        if (from.root === null) return "unknown";
        for (const r of rootsSeen(from.root)) {
            const got = topAt(at(r, rel), pkg, name);
            if (got !== "absent") return got;
        }
        return "absent";
    };

    /** A type by its parts, `a.b.Outer.Inner`, as a file sees it: an import's names its declared member types alone; none (with its name) when no root it sees holds it. */
    const fqnType = (from: JFile, segs: readonly string[], imported = false): TypeRes => {
        const tf = typeFile(segs);
        if (!tf) return NONE;
        const l = libNamed(segs.join("."));
        if (jdkPackage(tf.pkg)) return l ? { k: "lib", lib: l } : { k: "none", fqn: segs.join(".") };
        const got = typeIn(from, tf.pkg, tf.top, tf.rel);
        // A JDK type known is the JDK's where no root it sees is known to hold a file of its name: the reads never look for `javax.net.ssl.SSLEngine` in the repository.
        if (l && (got === "absent" || (got === "unknown" && from.root !== null && rootsSeen(from.root).every((r) => exists(at(r, tf.rel)) !== true)))) return { k: "lib", lib: l };
        if (got === "unknown") return UNKNOWN;
        if (got === "absent") return { k: "none", fqn: segs.join(".") };
        let res: TypeRes = { k: "type", t: got };
        for (const name of tf.nested) {
            if (res.k !== "type") return UNKNOWN;
            const own = membersOf(res.t).types.get(name);
            if (imported) {
                if (!own) return NONE;
                res = { k: "type", t: own };
                continue;
            }
            const m = memberType(res.t, name);
            if (m.found === undefined) return m.complete ? NONE : UNKNOWN;
            res = m.found;
        }
        return res;
    };

    // Declared members, the implicit ones included.
    const memberCache = new Map<JType, Members>();
    const membersOf = (T: JType): Members => {
        let hit = memberCache.get(T);
        if (hit) return hit;
        const found: Members = { methods: new Map(), ctors: [], fields: new Map(), types: new Map() };
        memberCache.set(T, found);
        const t = T.file.t;
        const iface = T.kind === "interface" || T.kind === "annotation";
        const addMethod = (m: JMethod) => found.methods.set(m.name, [...(found.methods.get(m.name) ?? []), m]);
        const components = T.kind === "record" ? recordComponents(T) : [];
        const method = (decl: number): JMethod => {
            const ty = t.type[decl];
            const ps = namedChildren(t, child(t, decl, "parameters")).filter((c) => t.type[c] === "formal_parameter" || t.type[c] === "spread_parameter");
            const compact = ty === "compact_constructor_declaration";
            const isStatic = has(t, decl, "static");
            return {
                name: CONSTRUCTORS.has(ty) ? T.name : textOf(t, child(t, decl, "name")),
                owner: T,
                node: decl,
                unit: T.file.f.unitByNode.get(decl),
                n: compact ? components.length : ps.length,
                varargs: (compact ? components : ps).some((c) => t.type[c] === "spread_parameter"),
                isStatic,
                abstract: ty === "annotation_type_element_declaration" || has(t, decl, "abstract") || (iface && child(t, decl, "body") < 0 && !isStatic && !has(t, decl, "default") && !has(t, decl, "private")),
                access: accessOf(t, decl, iface),
                key: lazy(() => keyOfParams(T.file, compact ? components : ps)),
                params: lazy(() => (compact ? paramTypes(T.file, components) : paramTypes(T.file, ps, loneVars(t, decl, ps)))),
            };
        };
        const field = (typeNode: number, dims: number, isStatic: boolean, access: Access): JField => ({
            owner: T,
            access,
            isStatic,
            type: lazy(() => (typeNode >= 0 && dims === 0 ? typeOfNode(T.file, typeNode) : null)),
            static: lazy(() => staticType(T.file, typeNode, dims)),
            typeVar: lazy(() => (dims === 0 && !isStatic ? classTypeVar(T, typeNode) : null)),
        });
        const body = T.kind === "anonymous" || T.kind === "constant" ? T.node : child(t, T.node, "body");
        for (const c of namedChildren(t, body).flatMap((c) => (t.type[c] === "enum_body_declarations" ? namedChildren(t, c) : [c]))) {
            const ty = t.type[c];
            if (ty === "method_declaration" || ty === "annotation_type_element_declaration") addMethod(method(c));
            else if (CONSTRUCTORS.has(ty)) found.ctors.push(method(c));
            else if (ty === "field_declaration" || ty === "constant_declaration") {
                for (let d = t.first[c]; d >= 0; d = t.next[d]) {
                    const name = t.field[d] === "declarator" ? child(t, d, "name") : -1;
                    if (name >= 0) found.fields.set(textOf(t, name), field(child(t, c, "type"), dimsOf(t, child(t, d, "dimensions")), iface || has(t, c, "static"), accessOf(t, c, iface)));
                }
            } else if (ty === "enum_constant") found.fields.set(textOf(t, child(t, c, "name")), { owner: T, access: "public", isStatic: true, type: () => T, static: () => ({ k: "ref", key: typeKey(T), type: T }), typeVar: () => null });
            else if (TYPES.has(ty)) found.types.set(textOf(t, child(t, c, "name")), T.file.byNode.get(c)!);
        }
        const implicit = (name: string, n: number, isStatic: boolean, key: string, at?: { node: number; unit: Unit | undefined }): JMethod => ({ name, owner: T, node: at?.node ?? -1, unit: at?.unit, n, varargs: false, isStatic, abstract: false, access: "public", key: () => key, params: () => (key ? key.split(",").map(libParam) : []) });
        if (T.kind === "enum") {
            addMethod(implicit("values", 0, true, ""));
            addMethod(implicit("valueOf", 1, true, "java.lang.String"));
        }
        for (const c of components) {
            const name = textOf(t, child(t, c, "name") >= 0 ? child(t, c, "name") : (namedChildren(t, namedChildren(t, c).find((x) => t.type[x] === "variable_declarator") ?? -1)[0] ?? c));
            found.fields.set(name, field(t.type[c] === "formal_parameter" ? child(t, c, "type") : -1, 0, false, "private"));
            // An accessor the record doesn't declare is implicit: declared by its component, so on the record's card, and of the component's type.
            if (!(found.methods.get(name) ?? []).some((m) => m.n === 0)) addMethod(implicit(name, 0, false, "", { node: c, unit: T.unit }));
        }
        return found;
    };
    const recordComponents = (T: JType) => namedChildren(T.file.t, child(T.file.t, T.node, "parameters")).filter((c) => T.file.t.type[c] === "formal_parameter" || T.file.t.type[c] === "spread_parameter");

    /** A parameter list's types, as keys that tell types apart: a type read by its id, a JDK or imported type by its name, a primitive by its keyword; null when one can't be told. */
    const keyOfParams = (jf: JFile, params: readonly number[]): string | null => {
        const t = jf.t;
        const keys: string[] = [];
        for (const p of params) {
            const spread = t.type[p] === "spread_parameter";
            const typeNode = spread ? spreadType(t, p) : child(t, p, "type");
            const k = keyOfType(jf, typeNode, (spread ? 1 : 0) + dimsOf(t, child(t, p, "dimensions")));
            if (k === null) return null;
            keys.push(k);
        }
        return keys.join(",");
    };
    const dimsOf = (t: Flat, dims: number) => (dims < 0 ? 0 : (textOf(t, dims).match(/\[/g) ?? []).length);
    /** A variable's array dimensions written after its name, `int x[]`; a varargs parameter's one. */
    const bindingDims = (t: Flat, b: GBinding): number => {
        const p = t.parent[b.node];
        return t.type[p] === "variable_declarator" && t.type[t.parent[p]] === "spread_parameter" ? 1 : dimsOf(t, child(t, p, "dimensions"));
    };
    /** A type's key, a type variable's its erasure's (its first bound's, else Object's): methods whose parameters' keys match override one another, or clash (JLS 8.4.2). */
    const keyOfType = (jf: JFile, n: number, dims: number, depth = 0): string | null => {
        const t = jf.t;
        if (n < 0 || depth > 8) return null;
        const ty = t.type[n];
        if (ty === "integral_type" || ty === "floating_point_type" || ty === "boolean_type") return textOf(t, n) + "[]".repeat(dims);
        if (ty === "array_type") return keyOfType(jf, child(t, n, "element"), dims + dimsOf(t, child(t, n, "dimensions")), depth);
        const parts = typeParts(t, n);
        const r = parts.length > 0 ? resolveParts(jf, n, parts) : NONE;
        if (r.k === "param") {
            const tp = typeParameterOf(jf, n, parts[0]);
            const bound = tp < 0 ? undefined : namedChildren(t, tp).find((c) => t.type[c] === "type_bound");
            return tp < 0 ? null : bound === undefined ? `java.lang.Object${"[]".repeat(dims)}` : keyOfType(jf, code(t, bound)[0] ?? -1, dims, depth + 1);
        }
        const name = r.k === "type" ? typeKey(r.t) : r.k === "lib" ? r.lib.fqn : r.k === "none" ? (r.fqn ?? null) : null;
        return name === null ? null : name + "[]".repeat(dims);
    };
    /** The `type_parameter` that declares a type variable's name at a node, or -1. */
    const typeParameterOf = (jf: JFile, n: number, name: string): number => {
        for (let s: GScope | null = scopeOf(jf, n); s; s = s.parent) {
            const bs = visible(jf, s.names.get(name), jf.t.start[n]).filter((b) => b.kind === "type");
            if (bs.length > 0) return isTypeParam(jf, bs[bs.length - 1]) ? jf.t.parent[bs[bs.length - 1].node] : -1;
        }
        return -1;
    };

    /**
     * A type as written, type arguments and all, by the keys of the types it
     * names (`java.util.Map<java.lang.reflect.TypeVariable<?>,java.lang.reflect.Type>`);
     * undefined where a name isn't known or is a type variable.
     */
    const writtenKey = (jf: JFile, n: number): string | undefined => {
        const t = jf.t;
        const ty = t.type[n];
        if (ty === "integral_type" || ty === "floating_point_type" || ty === "boolean_type") return textOf(t, n);
        if (ty === "annotated_type") {
            const inner = code(t, n).find((c) => !isAnnotation(t, c));
            return inner === undefined ? undefined : writtenKey(jf, inner);
        }
        if (ty === "array_type") {
            const elem = writtenKey(jf, child(t, n, "element"));
            return elem === undefined ? undefined : elem + "[]".repeat(dimsOf(t, child(t, n, "dimensions")));
        }
        // `Outer<A>.Inner` names its outer type's arguments where its key doesn't.
        if (ty !== "generic_type") for (let x = n; x <= gapsOf(t).last[n]; x++) if (t.type[x] === "type_arguments") return undefined;
        const parts = typeParts(t, n);
        if (parts.length === 0) return undefined;
        const r = resolveParts(jf, n, parts);
        const base = r.k === "type" ? typeKey(r.t) : r.k === "lib" ? r.lib.fqn : r.k === "none" && r.fqn ? r.fqn : undefined;
        if (base === undefined || ty !== "generic_type") return base;
        const targs = argsKey(jf, n);
        return targs === undefined ? undefined : base + targs;
    };
    /** A generic type node's type arguments as written, by `writtenKey` (`<?,? extends java.lang.Number>`); undefined where one isn't known. */
    const argsKey = (jf: JFile, n: number): string | undefined => {
        const t = jf.t;
        const lists = code(t, n).filter((c) => t.type[c] === "type_arguments");
        if (lists.length !== 1 || code(t, n).some((c) => t.type[c] === "scoped_type_identifier")) return undefined;
        const out: string[] = [];
        for (const c of code(t, lists[0])) {
            if (t.type[c] !== "wildcard") {
                const k = writtenKey(jf, c);
                if (k === undefined) return undefined;
                out.push(k);
                continue;
            }
            const bound = code(t, c).filter((b) => !isAnnotation(t, b));
            if (bound.length === 0) {
                out.push("?");
                continue;
            }
            const k = writtenKey(jf, bound[bound.length - 1]);
            if (k === undefined) return undefined;
            out.push(`? ${hasToken(t, c, "super") ? "super" : "extends"} ${k}`);
        }
        return `<${out.join(",")}>`;
    };

    /** A parameter's or a variable's static type from its written type node; `dims` more array dimensions; `lone`, its method's type variables `constrained` lets go. */
    const staticType = (jf: JFile, n: number, dims = 0, lone: ReadonlySet<string> = NO_VARS): SType => {
        const t = jf.t;
        const wrap = (x: SType, d: number): SType => (d > 0 ? wrap({ k: "array", elem: x }, d - 1) : x);
        if (n < 0) return UNTYPED;
        const ty = t.type[n];
        if (ty === "integral_type" || ty === "floating_point_type" || ty === "boolean_type") return wrap({ k: "prim", name: textOf(t, n) }, dims);
        if (ty === "array_type") return staticType(jf, child(t, n, "element"), dims + dimsOf(t, child(t, n, "dimensions")));
        const parts = typeParts(t, n);
        if (parts.length === 0) return UNTYPED;
        const r = resolveParts(jf, n, parts);
        const targs = constrained(t, n, lone) && t.type[n] === "generic_type" ? argsKey(jf, n) : undefined;
        const args = constrained(t, n, lone) ? { args: true as const, ...(targs !== undefined ? { targs } : {}) } : {};
        const base: SType =
            r.k === "type" ? { k: "ref", key: typeKey(r.t), type: r.t, ...args } : r.k === "lib" ? { k: "ref", key: r.lib.fqn, type: r.lib, ...args } : r.k === "param" ? { k: "var" } : r.k === "none" && r.fqn ? { k: "ref", key: r.fqn, ...args } : UNTYPED;
        return wrap(base, dims);
    };
    /** A parameter list's static types, a varargs one as its array; `lone`, as for `staticType`. */
    const paramTypes = (jf: JFile, params: readonly number[], lone: ReadonlySet<string> = NO_VARS): SType[] =>
        params.map((p) => {
            const t = jf.t;
            return t.type[p] === "spread_parameter" ? staticType(jf, spreadType(t, p), 1, lone) : staticType(jf, child(t, p, "type"), dimsOf(t, child(t, p, "dimensions")), lone);
        });

    const exprTypes = new Map<JFile, Map<number, SType>>();
    /** An expression's static type, where the code shows it: a literal, `this`, a creation, a cast, a variable's or a field's written type, a method's written result. */
    const exprType = (jf: JFile, e: number): SType => {
        let byNode = exprTypes.get(jf);
        if (!byNode) exprTypes.set(jf, (byNode = new Map()));
        const hit = byNode.get(e);
        if (hit) return hit;
        byNode.set(e, UNTYPED);
        const v = exprTypeUncached(jf, e);
        byNode.set(e, v);
        return v;
    };
    const STRING: SType = { k: "ref", key: "java.lang.String" };
    const BOOLEAN: SType = { k: "prim", name: "boolean" };
    const exprTypeUncached = (jf: JFile, e: number): SType => {
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
                return c ? { k: "ref", key: typeKey(c), type: c } : UNTYPED;
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
                if (anon) return { k: "ref", key: typeKey(anon), type: anon };
                return qualifiedCreation(t, e) ? UNTYPED : staticType(jf, child(t, e, "type"));
            }
            case "array_creation_expression":
                return staticType(jf, child(t, e, "type"), namedChildren(t, e).filter((c) => t.field[c] === "dimensions").reduce((n, c) => n + (textOf(t, c).match(/\[/g) ?? []).length, 0));
            case "identifier":
                return variableType(jf, e, text());
            case "field_access": {
                const obj = child(t, e, "object");
                const field = child(t, e, "field");
                if (t.type[field] === "this") {
                    const q = exprVal(jf, obj);
                    return q.k === "type" && q.res.k === "type" ? { k: "ref", key: typeKey(q.res.t), type: q.res.t } : UNTYPED;
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
                return bound ? { k: "ref", key: typeKey(bound), type: bound } : rt >= 0 ? staticType(m.owner.file, rt) : UNTYPED;
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
    };
    /** A name's static type where it is a variable: a local's or a parameter's written type (`var`: its value's), a field's. */
    const variableType = (jf: JFile, n: number, name: string): SType => {
        const at = jf.t.start[n];
        for (let s: GScope | null = scopeOf(jf, n); s; s = s.parent) {
            const vs = visible(jf, s.names.get(name), at).filter((b) => b.kind === "local" || b.kind === "param");
            if (vs.length > 0) {
                if (vs.length > 1) return UNTYPED;
                const b = vs[0];
                if (b.typeNode !== undefined) return staticType(jf, b.typeNode, bindingDims(jf.t, b));
                return b.init !== undefined ? exprType(jf, b.init) : UNTYPED;
            }
            if (s.kind === "class") {
                const T = jf.byNode.get(s.node);
                if (!T) return UNTYPED;
                if (!inBody(T, n)) continue;
                const fd = fieldOf(T, name);
                if (fd.found !== undefined) return fd.found === "unknown" ? UNTYPED : fieldStatic(T, fd.found, true);
                if (!fd.complete) return UNTYPED;
            }
            if (s.kind === "module") break;
        }
        const sf = staticField(jf, name);
        return sf && sf !== "unknown" ? sf.static() : UNTYPED;
    };

    /** Whether a reference type's every supertype is known, and the keys of them all, itself among them. */
    const closures = new Map<JType | Lib, { keys: Set<string>; complete: boolean }>();
    const closureOf = (x: JType | Lib): { keys: Set<string>; complete: boolean } => {
        let hit = closures.get(x);
        if (hit) return hit;
        hit = { keys: new Set([keyOfRef(x)]), complete: true };
        closures.set(x, hit);
        for (const s of supersOf(x)) {
            if (!s) {
                hit.complete = false;
                continue;
            }
            const c = closureOf(s);
            for (const k of c.keys) hit.keys.add(k);
            if (!c.complete) hit.complete = false;
        }
        return hit;
    };
    const keyOfRef = (x: JType | Lib) => ("fqn" in x ? x.fqn : typeKey(x));
    /** What a type known by key alone is: one read, or a JDK type the table holds. */
    const refType = (s: SType & { k: "ref" }): JType | Lib | undefined => s.type ?? libNamed(s.key);

    /**
     * Whether an argument of type `a` may be passed for a parameter of type
     * `p`: by identity or widening alone (strict), or also by boxing and
     * unboxing (loose). "maybe" wherever a type isn't known.
     */
    const fits = (a: SType, p: SType, loose: boolean): Fit => {
        if (a.k === "unknown" || p.k === "unknown" || p.k === "null" || p.k === "fn") return "maybe";
        if (a.k === "fn") return p.k === "var" ? "maybe" : p.k === "ref" ? takesFn(p, a.arity) : "no";
        if (p.k === "var") return a.k === "prim" && !loose ? "no" : "maybe";
        if (a.k === "var") return p.k === "prim" ? (loose ? "maybe" : "no") : "maybe";
        if (a.k === "null") return p.k === "prim" ? "no" : "yes";
        if (a.k === "prim") {
            if (p.k === "prim") return a.name === p.name || (WIDENING[a.name] ?? []).includes(p.name) ? "yes" : "no";
            if (!loose || p.k === "array") return "no";
            // Boxing, then a widening reference conversion (JLS 5.3).
            return fits({ k: "ref", key: BOXES[a.name] }, p, true);
        }
        if (p.k === "prim") {
            // Only the eight boxes unbox (JLS 5.1.8).
            if (!loose || a.k === "array") return "no";
            const prim = UNBOXED[a.key];
            return prim && (prim === p.name || (WIDENING[prim] ?? []).includes(p.name)) ? "yes" : "no";
        }
        if (a.k === "array") {
            if (p.k === "array") return a.elem.k === "prim" || p.elem.k === "prim" ? (a.elem.k === "prim" && p.elem.k === "prim" ? (a.elem.name === p.elem.name ? "yes" : "no") : sameType(a.elem, p.elem) ? "yes" : "no") : fits(a.elem, p.elem, false);
            return ["java.lang.Object", "java.lang.Cloneable", "java.io.Serializable"].includes(p.key) ? "yes" : "no";
        }
        if (p.k === "array") return "no";
        // A parameterized parameter type (`Collection<? extends Project>`) takes a subtype of its erasure only as its arguments allow: for sure, only itself written alike.
        if (p.args && p.targs !== undefined && a.key === p.key && a.targs === p.targs) return "yes";
        const yes: Fit = p.args ? "maybe" : "yes";
        if (a.key === p.key || p.key === "java.lang.Object") return yes;
        // No other type is a final class's subtype but an enum constant's class, whose supertype is known.
        const pt = refType(p);
        const final = pt !== undefined && isFinal(pt);
        const at = refType(a);
        if (!at) return final ? "no" : "maybe";
        const c = closureOf(at);
        return c.keys.has(p.key) ? yes : c.complete || final ? "no" : "maybe";
    };
    /** JDK classes their specification makes final. */
    const FINAL_LIB = new Set(["java.lang.String", "java.lang.Class", "java.lang.StringBuilder", "java.lang.StringBuffer", "java.util.Optional", ...Object.values(BOXES)]);
    /** Whether no type but itself (and an enum's constants' classes) extends a type: a final class, an enum, a record. */
    const isFinal = (x: JType | Lib) => ("fqn" in x ? FINAL_LIB.has(x.fqn) : x.kind === "enum" || x.kind === "record" || (x.kind === "class" && has(x.file.t, x.node, "final")));
    /**
     * Whether a lambda (of `arity` parameters; null: a method reference) may
     * stand for a parameter of a type (JLS 15.12.2.1): never a class's, nor an
     * interface's of no abstract method or of several, nor one whose method
     * takes another number of parameters.
     */
    const takesFn = (p: SType & { k: "ref" }, arity: number | null): Fit => {
        const x = refType(p);
        if (!x) return "maybe";
        if (!isIface(x)) return "no";
        const shape = fnShape(x);
        if (!shape) return "maybe";
        if (shape.length !== 1) return "no";
        return arity === null || shape[0].some((m) => m.varargs || m.n === arity) ? "maybe" : "no";
    };
    /** Object's public methods, which an interface's abstract methods don't count (JLS 9.8). */
    const OBJECT_PUBLIC = new Set(["equals/1", "hashCode/0", "toString/0", "getClass/0", "notify/0", "notifyAll/0", "wait/0", "wait/1", "wait/2"]);
    const shapes = new Map<JType | Lib, JMethod[][] | null>();
    /** An interface's abstract methods, by name; null where not all are known, or where a default one may override one whose parameter types can't be compared. */
    const fnShape = (x: JType | Lib): JMethod[][] | null => {
        if (shapes.has(x)) return shapes.get(x)!;
        shapes.set(x, null);
        const names = new Set<string>();
        const seen = new Set<JType | Lib>();
        const walk = (y: JType | Lib | null): boolean => {
            if (!y) return false;
            if (seen.has(y)) return true;
            seen.add(y);
            if ("fqn" in y) {
                if (!y.members) return false;
                for (const m of y.methods) names.add(m.name);
            } else for (const name of membersOf(y).methods.keys()) names.add(name);
            return supersOf(y).every(walk);
        };
        let shape: JMethod[][] | null = walk(x) ? [] : null;
        for (const name of names) {
            if (!shape) break;
            const set = methodsOf(x, name);
            const live = set.list.filter((m) => !m.isStatic && !OBJECT_PUBLIC.has(`${m.name}/${m.n}`));
            const abstract = live.filter((m) => m.abstract);
            if (!set.complete || live.some((m) => !m.abstract && abstract.some((a) => a.n === m.n && (a.key() === null || m.key() === null)))) shape = null;
            else if (abstract.length > 0) shape.push(abstract);
        }
        shapes.set(x, shape);
        return shape;
    };
    /** Whether a method may take the arguments: in javac's first phase (strict), its second (loose), or its third (varargs, loose). */
    const applies = (m: JMethod, args: readonly SType[], phase: 1 | 2 | 3): Fit => {
        const ps = m.params();
        if (phase < 3 ? ps.length !== args.length : !m.varargs || args.length < ps.length - 1) return "no";
        const last = ps[ps.length - 1];
        let all: Fit = "yes";
        for (let i = 0; i < args.length; i++) {
            const p = phase === 3 && i >= ps.length - 1 ? (last.k === "array" ? last.elem : last.k === "var" ? last : UNTYPED) : ps[i];
            const f = fits(args[i], p, phase > 1);
            if (f === "no") return "no";
            if (f === "maybe") all = "maybe";
        }
        return all;
    };
    /** Whether type `a` is provably a subtype of `b`, primitives by widening. */
    const subtype = (a: SType, b: SType): boolean => {
        if (a.k === "prim" && b.k === "prim") return a.name === b.name || (WIDENING[a.name] ?? []).includes(b.name);
        // A parameterized supertype needs its arguments compared: for sure, only itself written alike.
        if (b.k === "ref" && b.args) return a.k === "ref" && a.key === b.key && b.targs !== undefined && a.targs === b.targs;
        if (a.k === "array" && b.k === "array") return a.elem.k === "prim" ? sameType(a.elem, b.elem) : subtype(a.elem, b.elem);
        if (a.k === "array" && b.k === "ref") return ["java.lang.Object", "java.lang.Cloneable", "java.io.Serializable"].includes(b.key);
        if (a.k !== "ref" || b.k !== "ref") return false;
        if (a.key === b.key || b.key === "java.lang.Object") return true;
        const at = refType(a);
        return !!at && closureOf(at).keys.has(b.key);
    };
    /** Whether `m` is more specific than `o` (JLS 15.12.2.5), provably: each of its parameter types a subtype of the other's. */
    const moreSpecific = (m: JMethod, o: JMethod): boolean => {
        const a = m.params();
        const b = o.params();
        return a.length === b.length && a.every((p, i) => subtype(p, b[i]));
    };
    /**
     * Of overloads that all fit a call's number of arguments, the one javac
     * picks, where the arguments' static types prove it (JLS 15.12.2): when
     * one applies for sure in the first phase, javac picks among those that
     * may apply there, the most specific; with none sure, any phase may
     * decide, so only one that may apply in some phase is sure.
     */
    const byArguments = <M extends JMethod>(cands: readonly M[], args: readonly SType[]): M | null => {
        const first = cands.map((m) => applies(m, args, 1));
        if (first.includes("yes")) {
            const may = cands.filter((_, i) => first[i] !== "no");
            if (may.length === 1) return may[0];
            const best = may.filter((m) => first[cands.indexOf(m)] === "yes" && may.every((o) => o === m || (moreSpecific(m, o) && !moreSpecific(o, m))));
            return best.length === 1 ? best[0] : null;
        }
        const any = cands.filter((m) => applies(m, args, 1) !== "no" || applies(m, args, 2) !== "no" || applies(m, args, 3) !== "no");
        return any.length === 1 ? any[0] : null;
    };
    const argTypes = (jf: JFile, call: number): SType[] => code(jf.t, child(jf.t, call, "arguments")).map((a) => exprType(jf, a));

    /** A class's type parameters' names, in order. */
    const typeParamsOf = (T: JType): string[] => {
        const t = T.file.t;
        return code(t, child(t, T.node, "type_parameters")).map((tp) => namedChildren(t, tp).find((c) => t.type[c] === "type_identifier") ?? -1).map((id) => (id >= 0 ? textOf(t, id) : ""));
    };
    /** The type variable of class T a type node names, `MM` of `class Test<MM>`, or null: a method's own variable, any other type. */
    const classTypeVar = (T: JType, n: number): string | null => {
        const t = T.file.t;
        if (n < 0 || t.type[n] !== "type_identifier") return null;
        const tp = typeParameterOf(T.file, n, textOf(t, n));
        return tp >= 0 && t.parent[t.parent[tp]] === T.node ? textOf(t, n) : null;
    };
    type View = { k: "type"; t: JType } | { k: "var"; name: string } | null;
    /**
     * What type variable `name` of class C means as a member of X, a subtype
     * of C (JLS 4.5.2): the class X's supertype clauses bind it to, or a type
     * variable of X's own; null where a raw type, a wildcard, any other
     * argument, or two paths that disagree leave it unknown.
     */
    const viewOf = (X: JType, C: JType, name: string, depth = 0): View => {
        if (X === C) return { k: "var", name };
        if (depth > 20) return null;
        const t = X.file.t;
        let found: View | undefined;
        for (const sn of supertypeNodes(t, X.node)) {
            const r = resolveParts(X.file, sn, typeParts(t, sn));
            if (r.k !== "type" || !closureOf(r.t).keys.has(typeKey(C))) continue;
            const up = viewOf(r.t, C, name, depth + 1);
            let here: View = up?.k === "type" ? up : null;
            if (up?.k === "var") {
                const params = typeParamsOf(r.t);
                const generic = t.type[sn] === "generic_type" ? namedChildren(t, sn).find((c) => t.type[c] === "type_arguments") : undefined;
                const args = generic === undefined ? [] : code(t, generic);
                const arg = args.length === params.length ? (args[params.indexOf(up.name)] ?? -1) : -1;
                const a = arg >= 0 ? resolveParts(X.file, arg, typeParts(t, arg)) : NONE;
                here = a.k === "type" ? { k: "type", t: a.t } : a.k === "param" && classTypeVar(X, arg) !== null ? { k: "var", name: textOf(t, arg) } : null;
            }
            if (found !== undefined && !(found?.k === here?.k && (found?.k === "type" ? found.t === (here as typeof found).t : found?.name === (here as typeof found)?.name))) return null;
            found = here;
        }
        return found ?? null;
    };
    /**
     * The class a member's type variable means as a member of S: what S's
     * supertype clauses bind it to (`class Test extends Box<Real>`), or, where
     * it is S's own variable and free (`free`: in S's code, through `this` or
     * `super`), its one bound. Elsewhere a receiver of S's type may bind S's
     * own variables to anything (`Box<Sub> b`): then nothing.
     */
    const viewType = (S: JType | Lib | null, C: JType | Lib, name: string | null, free: boolean): JType | null => {
        if (!S || !name || "fqn" in S || "fqn" in C) return null;
        const v = viewOf(S, C, name);
        if (v?.k !== "var") return v?.k === "type" ? v.t : null;
        if (!free) return null;
        const t = S.file.t;
        const tp = code(t, child(t, S.node, "type_parameters")).find((c) => textOf(t, namedChildren(t, c).find((x) => t.type[x] === "type_identifier") ?? c) === v.name);
        return tp === undefined ? null : boundOf(S.file, tp);
    };
    /** A type variable's one bound, whose members are the variable's (JLS 4.4); null for none, several, or one not read. */
    const boundOf = (jf: JFile, tp: number): JType | null => {
        const t = jf.t;
        const bound = namedChildren(t, tp).find((c) => t.type[c] === "type_bound");
        const types = bound === undefined ? [] : code(t, bound);
        if (types.length !== 1) return null;
        const r = resolveParts(jf, types[0], typeParts(t, types[0]));
        return r.k === "type" ? r.t : null;
    };
    /** A field's type as a member of S, through `this` or `super` in S's code (`free`) or an expression of S's type. */
    const fieldType = (S: JType | Lib, fd: JField, free: boolean): JType | null => fd.type() ?? viewType(S, fd.owner, fd.typeVar(), free);
    const fieldStatic = (S: JType | Lib, fd: JField, free: boolean): SType => {
        const v = fd.typeVar() ? viewType(S, fd.owner, fd.typeVar(), free) : null;
        return v ? { k: "ref", key: typeKey(v), type: v } : fd.static();
    };

    // Supertypes, read where the declaration is written, where its own members aren't in scope.
    const superCache = new Map<JType | Lib, (JType | Lib | null)[]>();
    const supersOf = (x: JType | Lib): (JType | Lib | null)[] => {
        const hit = superCache.get(x);
        if (hit) return hit;
        // A cycle reads as a supertype not known.
        superCache.set(x, [null]);
        let supers: (JType | Lib | null)[];
        if ("fqn" in x) supers = x.supers.length > 0 ? x.supers.map((s) => libNamed(s) ?? null) : x === OBJECT() || x === INTERFACE_OBJECT() ? [] : [x.iface ? INTERFACE_OBJECT() : OBJECT()];
        else {
            const t = x.file.t;
            const written = supertypeNodes(t, x.node).map((n): JType | Lib | null => {
                const r = resolveParts(x.file, n, typeParts(t, n));
                return r.k === "type" ? r.t : r.k === "lib" ? r.lib : null;
            });
            // A header that didn't parse as written may name other supertypes.
            if (x.kind !== "anonymous" && x.kind !== "constant" && headerGap(t, x.node)) supers = [null];
            else if (x.kind === "class") supers = child(t, x.node, "superclass") >= 0 ? written : [OBJECT(), ...written];
            else if (x.kind === "interface") supers = written.length > 0 ? written : [INTERFACE_OBJECT()];
            else if (x.kind === "enum") supers = [libNamed("java.lang.Enum")!, ...written];
            else if (x.kind === "record") supers = [libNamed("java.lang.Record")!, ...written];
            else if (x.kind === "annotation") supers = [libNamed("java.lang.annotation.Annotation")!];
            else if (x.kind === "constant") supers = [x.outer];
            // An anonymous class extends a class, or Object and an interface.
            else supers = written[0] && isIface(written[0]) ? [OBJECT(), written[0]] : written.length > 0 ? written : [null];
        }
        superCache.set(x, supers);
        return supers;
    };
    /** The class a type extends, or null: none (an interface, Object) or not known. */
    const superclassOf = (x: JType | Lib): JType | Lib | null => supersOf(x).find((s) => s === null || !isIface(s)) ?? null;

    /** Whether a supertype's member is a type's too: never a private one, nor one of the package's from another package. */
    const inherits = (x: JType | Lib, m: { access: Access; owner: JType | Lib }) => m.access !== "private" && !(m.access === "package" && pkgOf(m.owner) !== pkgOf(x));

    type MethodSet = { list: JMethod[]; complete: boolean };
    const methodCache = new Map<JType | Lib, Map<string, MethodSet>>();
    const libMethods = new Map<Lib, Map<string, JMethod[]>>();
    const declaredMethods = (x: JType | Lib, name: string): JMethod[] => {
        if (!("fqn" in x)) return membersOf(x).methods.get(name) ?? [];
        let byName = libMethods.get(x);
        if (!byName) {
            const made = new Map<string, JMethod[]>();
            for (const m of x.methods) made.set(m.name, [...(made.get(m.name) ?? []), { ...m, owner: x, node: -1, unit: undefined, key: () => m.key, params: lazy(() => m.params.map(libParam)) }]);
            libMethods.set(x, (byName = made));
        }
        return byName.get(name) ?? [];
    };
    /**
     * A type's methods of a name, declared and inherited, and whether every
     * supertype is known. An interface's static method is no member of what
     * extends it. A declared method hides an inherited one of the same
     * parameter types, and a class's concrete method an interface's.
     */
    const methodsOf = (x: JType | Lib, name: string): MethodSet => {
        let byName = methodCache.get(x);
        if (!byName) methodCache.set(x, (byName = new Map()));
        const hit = byName.get(name);
        if (hit) return hit;
        // A cycle reads as not known.
        byName.set(name, { list: [], complete: false });
        const own = declaredMethods(x, name);
        let complete = "fqn" in x ? x.members : !openOf(x);
        const inherited: JMethod[] = [];
        for (const s of supersOf(x)) {
            if (!s) {
                complete = false;
                continue;
            }
            const set = methodsOf(s, name);
            if (!set.complete) complete = false;
            for (const m of set.list) if (inherits(x, m) && !(m.isStatic && isIface(m.owner)) && !inherited.includes(m)) inherited.push(m);
        }
        const same = (a: JMethod, b: JMethod) => a.n === b.n && a.varargs === b.varargs && a.key() !== null && a.key() === b.key();
        const all = [...own, ...inherited.filter((m) => !own.some((d) => same(d, m)))];
        const found = { list: all.filter((m) => !(isIface(m.owner) && all.some((c) => c !== m && !isIface(c.owner) && !c.abstract && same(c, m)))), complete };
        byName.set(name, found);
        return found;
    };

    /** A member type of a type, declared or inherited (found: unknown, a JDK type's); `complete` when no supertype not known may hold one. */
    const memberType = (x: JType | Lib, name: string, depth = 0): { found?: TypeRes; complete: boolean } => {
        if (depth > 40) return { complete: false };
        if ("fqn" in x) {
            const nested = x.types.has(name) ? libNamed(`${x.fqn}.${name}`) : undefined;
            if (x.types.has(name)) return { found: nested ? { k: "lib", lib: nested } : UNKNOWN, complete: true };
            if (!x.members) return { complete: false };
        } else {
            const own = membersOf(x).types.get(name);
            if (own) return { found: { k: "type", t: own }, complete: true };
            if (openOf(x)) return { complete: false };
        }
        let complete = true;
        let found: TypeRes | undefined;
        for (const s of supersOf(x)) {
            if (!s) {
                complete = false;
                continue;
            }
            const m = memberType(s, name, depth + 1);
            if (!m.complete) complete = false;
            if (m.found === undefined) continue;
            if (m.found.k === "type" && m.found.t.outer && !inherits(x, { access: accessOf(m.found.t.file.t, m.found.t.node, isIface(m.found.t.outer)), owner: m.found.t.outer })) continue;
            // Two different member types make the name ambiguous.
            found = found === undefined || (found.k === "type" && m.found.k === "type" && found.t === m.found.t) ? m.found : UNKNOWN;
        }
        return { ...(found !== undefined ? { found } : {}), complete };
    };

    /** A field of a type, declared or inherited ("unknown": a JDK type's, or ambiguous). */
    const fieldOf = (x: JType | Lib, name: string, depth = 0): { found?: JField | "unknown"; complete: boolean } => {
        if (depth > 40) return { complete: false };
        if ("fqn" in x) {
            if (x.fields.has(name)) return { found: "unknown", complete: true };
            if (!x.members) return { complete: false };
        } else {
            const own = membersOf(x).fields.get(name);
            if (own) return { found: own, complete: true };
            if (openOf(x)) return { complete: false };
        }
        let complete = true;
        let found: JField | "unknown" | undefined;
        for (const s of supersOf(x)) {
            if (!s) {
                complete = false;
                continue;
            }
            const m = fieldOf(s, name, depth + 1);
            if (!m.complete) complete = false;
            if (m.found === undefined || (m.found !== "unknown" && !inherits(x, m.found))) continue;
            found = found === undefined || found === m.found ? m.found : "unknown";
        }
        return { ...(found !== undefined ? { found } : {}), complete };
    };

    const scopeOf = (jf: JFile, n: number): GScope => jf.f.scopes[jf.f.enclosing[n]];
    /** The bindings of a scope a position sees: each from where it starts; a try's resource only in its own try block, never its catch or finally (JLS 14.20.3). */
    const visible = (jf: JFile, bs: GBinding[] | undefined, at: number) =>
        (bs ?? []).filter((b) => {
            if (b.from !== undefined && b.from > at) return false;
            const t = jf.t;
            if (t.type[t.parent[b.node]] !== "resource") return true;
            const body = child(t, t.parent[t.parent[t.parent[b.node]]], "body");
            return body >= 0 && at < t.end[body];
        });
    const isTypeParam = (jf: JFile, b: GBinding) => jf.t.type[jf.t.parent[b.node]] === "type_parameter";

    /** Whether a node is where a class's members are in scope (JLS 6.3): its body, and a record's components; not the rest of its header (annotations, type parameters, supertypes). */
    const inBody = (T: JType, n: number): boolean => {
        if (T.kind === "anonymous" || T.kind === "constant") return true;
        const t = T.file.t;
        const within = (x: number) => x >= 0 && t.start[x] <= t.start[n] && t.end[n] <= t.end[x];
        return within(child(t, T.node, "body")) || (T.kind === "record" && within(child(t, T.node, "parameters")));
    };

    /** The type a simple name means at a node. */
    const typeName = (jf: JFile, n: number, name: string): TypeRes => {
        const at = jf.t.start[n];
        for (let s: GScope | null = scopeOf(jf, n); s; s = s.parent) {
            const bs = visible(jf, s.names.get(name), at).filter((b) => b.kind === "type");
            if (s.kind === "class") {
                if (bs.some((b) => isTypeParam(jf, b))) return { k: "param" };
                const T = jf.byNode.get(s.node);
                if (!T) return UNKNOWN;
                if (inBody(T, n)) {
                    const m = memberType(T, name);
                    if (m.found !== undefined) return m.found;
                    if (!m.complete) return UNKNOWN;
                }
                continue;
            }
            if (s.kind === "module") break;
            if (bs.length > 0) {
                const b = bs[bs.length - 1];
                const local = jf.byNode.get(jf.t.parent[b.node]);
                return isTypeParam(jf, b) ? { k: "param" } : local ? { k: "type", t: local } : UNKNOWN;
            }
        }
        return topType(jf, name);
    };

    const ownerOf = (r: TypeRes): JType | Lib | null => (r.k === "type" ? r.t : r.k === "lib" ? r.lib : null);

    /**
     * A name at a file's top (JLS 6.4.1, 6.5.5): a type it declares, a
     * single-type import, a single static import's member type, a type of its
     * package in a root it sees, then java.lang's, once each such root is
     * known to hold none of the name. Past that nothing is sure: the package
     * may declare the type in a file of another name or in another module,
     * ahead of an on-demand import. A name in lower case, `java` of
     * `java.util.List`, is a package's.
     */
    const topType = (jf: JFile, name: string): TypeRes => {
        const own = jf.top.get(name);
        if (own) return { k: "type", t: own };
        const single = jf.singles.find((i) => i.local === name);
        if (single) return fqnType(jf, [...namesOf(single.spec), name], true);
        for (const i of jf.statics.filter((i) => i.local === name)) {
            const c = ownerOf(fqnType(jf, namesOf(i.spec), true));
            if (!c) return UNKNOWN;
            const m = memberType(c, name);
            if (m.found !== undefined) return m.found;
            if (!m.complete) return UNKNOWN;
        }
        if (!/^[A-Z]/.test(name)) return NONE;
        if (jf.root === null) return UNKNOWN;
        const got = typeIn(jf, jf.pkg, name, [...(jf.pkg ? jf.pkg.split(".") : []), `${name}.java`].join("/"));
        if (got !== "absent") return got === "unknown" ? UNKNOWN : { k: "type", t: got };
        if (!JAVA_LANG.has(name)) return UNKNOWN;
        const l = libNamed(`java.lang.${name}`);
        return l ? { k: "lib", lib: l } : { k: "none", fqn: `java.lang.${name}` };
    };

    /** A type written by its parts at a node: a simple name, `Outer.Inner`, `a.b.Foo`. */
    const resolveParts = (jf: JFile, n: number, parts: readonly string[]): TypeRes => {
        if (parts.length === 0) return NONE;
        let res = typeName(jf, n, parts[0]);
        if (parts.length === 1) return res;
        // A first name that is no type is a package's: `a.b.Foo`.
        if (res.k === "none" && !res.fqn) return fqnType(jf, parts);
        for (const name of parts.slice(1)) {
            if (res.k !== "type" && res.k !== "lib") return res.k === "none" ? UNKNOWN : res;
            const m = memberType(res.k === "type" ? res.t : res.lib, name);
            if (m.found === undefined) return m.complete ? NONE : UNKNOWN;
            res = m.found;
        }
        return res;
    };

    /** The class a type node names, read where it is written; null for a primitive, an array, a type parameter, a type not read. */
    const typeOfNode = (jf: JFile, n: number): JType | null => {
        const r = resolveParts(jf, n, typeParts(jf.t, n));
        return r.k === "type" ? r.t : null;
    };

    /** The innermost class around a node. */
    const classAround = (jf: JFile, n: number): JType | null => {
        for (let s: GScope | null = scopeOf(jf, n); s; s = s.parent) if (s.kind === "class") return jf.byNode.get(s.node) ?? null;
        return null;
    };

    /** A name before `.` or `::`, as the JLS reclassifies it (6.5.2): a variable, a static import's field, a type, then a package. */
    const nameVal = (jf: JFile, n: number, name: string): Val => {
        const at = jf.t.start[n];
        for (let s: GScope | null = scopeOf(jf, n); s; s = s.parent) {
            const vs = visible(jf, s.names.get(name), at).filter((b) => b.kind === "local" || b.kind === "param");
            if (vs.length > 0) return vs.length === 1 ? { k: "value", t: typeOfBinding(jf, vs[0]) } : UNSURE;
            if (s.kind === "class") {
                const T = jf.byNode.get(s.node);
                if (!T) return UNSURE;
                if (!inBody(T, n)) continue;
                const fd = fieldOf(T, name);
                if (fd.found !== undefined) return { k: "value", t: fd.found === "unknown" ? null : fieldType(T, fd.found, true) };
                if (!fd.complete) return UNSURE;
            }
            if (s.kind === "module") break;
        }
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

    const exprCache = new Map<JFile, Map<number, Val>>();
    /** What an expression is: a value of a type, a type, a package. */
    const exprVal = (jf: JFile, e: number): Val => {
        let byNode = exprCache.get(jf);
        if (!byNode) exprCache.set(jf, (byNode = new Map()));
        const hit = byNode.get(e);
        if (hit) return hit;
        // A cycle reads as nothing sure.
        byNode.set(e, UNSURE);
        const v = exprValUncached(jf, e);
        byNode.set(e, v);
        return v;
    };
    const exprValUncached = (jf: JFile, e: number): Val => {
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
    };
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
    const superVal = (jf: JFile, n: number): Val => {
        const c = classAround(jf, n);
        const s = c ? superclassOf(c) : null;
        return s && !("fqn" in s) ? { k: "value", t: s } : UNSURE;
    };
    /** The class a call's result is when its method returns a type variable of its class: what the receiver binds it to. */
    const resultView = (jf: JFile, nameNode: number, m: JMethod, rt: number): JType | null => {
        const recv = receivers.get(jf)?.get(nameNode);
        if (!recv || recv.kind === "type" || "fqn" in m.owner) return null;
        return viewType(recv.kind === "self" ? recv.view : recv.type, m.owner, classTypeVar(m.owner, rt), recv.kind === "self");
    };
    /** `q.name`, given what q is: a field (its type), a member type, a package's type or subpackage; `self`, the class whose own instance q is (`this`, `super`, `Outer.this`). */
    const memberVal = (jf: JFile, q: Val, name: string, self: JType | null): Val => {
        if (q.k === "package") {
            const res = fqnType(jf, [...q.name.split("."), name]);
            return res.k === "none" && !/^[A-Z]/.test(name) ? { k: "package", name: `${q.name}.${name}` } : res.k === "type" ? { k: "type", res } : UNSURE;
        }
        const T = q.k === "value" ? q.t : q.k === "type" && q.res.k === "type" ? q.res.t : null;
        if (!T) return UNSURE;
        const fd = fieldOf(T, name);
        if (fd.found !== undefined) return { k: "value", t: fd.found === "unknown" ? null : fieldType(self ?? T, fd.found, self !== null) };
        if (!fd.complete || q.k !== "type") return UNSURE;
        // A type's member type: `Outer.Inner`.
        const m = memberType(T, name);
        return m.found !== undefined ? { k: "type", res: m.found } : UNSURE;
    };

    /**
     * The methods a call with `k` arguments may reach (`k` null: a method
     * reference, any number): those of `k` parameters, and the varargs ones
     * that take `k`. With no argument, a method of no parameter always
     * applies, so javac's first phase takes it before any varargs one.
     */
    const reachable = <M extends { n: number; varargs: boolean }>(list: readonly M[], k: number | null): M[] => {
        if (k === null) return [...list];
        const fixed = list.filter((m) => !m.varargs && m.n === k);
        return k === 0 && fixed.length === 1 ? fixed : list.filter((m) => (m.varargs ? k >= m.n - 1 : k === m.n));
    };

    /** The top-level class a type is written in. */
    const topOfType = (T: JType): JType => (T.outer ? topOfType(T.outer) : T);

    /** How a call names its receiver: the code of a class around (`this`, `super`, none written; `view`, that class), a type (a static call), or an expression of a type. */
    type Recv = { kind: "self"; view: JType | null } | { kind: "type" } | { kind: "expr"; type: JType | Lib };

    /**
     * Whether code at a node may use a member (JLS 6.6): a private one inside
     * the top-level class that holds it; a package one from its package; a
     * protected one from its package, or from the body of a subclass, an
     * instance member there through the code's own instance or an expression
     * of that subclass's type. "maybe" where a supertype not read leaves it open.
     */
    const access = (jf: JFile, n: number, m: { access: Access; owner: JType | Lib; isStatic: boolean }, recv: Recv): Fit => {
        if (m.access === "public") return "yes";
        if (m.access === "private") {
            const here = classAround(jf, n);
            return !("fqn" in m.owner) && here !== null && topOfType(here) === topOfType(m.owner) ? "yes" : "no";
        }
        if (pkgOf(m.owner) === jf.pkg) return "yes";
        if (m.access === "package") return "no";
        const owner = keyOfRef(m.owner);
        let open = false;
        for (let S: JType | null = classAround(jf, n); S; S = S.outer) {
            const c = closureOf(S);
            if (!c.keys.has(owner)) {
                if (!c.complete) open = true;
                continue;
            }
            if (m.isStatic || recv.kind !== "expr") return "yes";
            const q = closureOf(recv.type);
            if (q.keys.has(keyOfRef(S))) return "yes";
            if (!q.complete) open = true;
        }
        return open ? "maybe" : "no";
    };
    /** Whether a static import names a member: one its file may use from the top, a public one or one of its own package's. */
    const importable = (jf: JFile, m: { access: Access; owner: JType | Lib }) => m.access === "public" || (m.access !== "private" && pkgOf(m.owner) === jf.pkg);

    /** Whether a method may take a call's arguments in some phase: one their types rule out is no answer, as code that compiles has another. */
    const mayApply = (m: JMethod, args: readonly SType[]) => applies(m, args, 1) !== "no" || applies(m, args, 2) !== "no" || applies(m, args, 3) !== "no";

    /** How each call that `pick` resolved names its receiver, by its name's node: what binds its class's type variables. */
    const receivers = new Map<JFile, Map<number, Recv>>();
    /** The one method of a set a call at node `n` with `k` arguments may reach (its arguments' types telling overloads apart); `owner`: the type searched. */
    const pick = (jf: JFile, n: number, owner: JType | Lib, set: MethodSet, k: number | null, recv: Recv): JMethod | null => {
        const m = pickUncached(jf, n, owner, set, k, recv);
        if (m) {
            let byNode = receivers.get(jf);
            if (!byNode) receivers.set(jf, (byNode = new Map()));
            byNode.set(n, recv);
        }
        return m;
    };
    const pickUncached = (jf: JFile, n: number, owner: JType | Lib, set: MethodSet, k: number | null, recv: Recv): JMethod | null => {
        const call = jf.t.parent[n];
        if (k !== null && gapIn(jf.t, child(jf.t, call, "arguments"))) return null;
        const usable = set.list.map((m) => ({ m, a: access(jf, n, m, recv) })).filter((x) => x.a !== "no");
        const possible = reachable(usable.map((x) => x.m), k);
        // A member whose access is open may or may not compete.
        if (usable.some((x) => x.a === "maybe" && possible.includes(x.m))) return null;
        if (possible.length > 1) return set.complete && k !== null ? byArguments(possible, argTypes(jf, call)) : null;
        if (possible.length !== 1) return null;
        const m = possible[0];
        if (k !== null && !mayApply(m, argTypes(jf, call))) return null;
        if (set.complete) return m;
        // With a supertype not read, only a call with no argument is sure, to a method nothing unseen replaces: the type's own, or a concrete one of a class it extends, no class between them open.
        if (k !== 0 || m.varargs || m.n !== 0) return null;
        for (let s: JType | Lib | null = owner; s; s = superclassOf(s)) {
            if (s === m.owner) return s === owner || !m.abstract ? m : null;
            if (!("fqn" in s) && openOf(s)) return null;
        }
        return null;
    };

    const argCount = (t: Flat, call: number): number => code(t, child(t, call, "arguments")).length;

    const callCache = new Map<JFile, Map<number, JMethod | null>>();
    /** The method a call's name reaches, or null. */
    const callOf = (jf: JFile, nameNode: number): JMethod | null => {
        let byNode = callCache.get(jf);
        if (!byNode) callCache.set(jf, (byNode = new Map()));
        if (byNode.has(nameNode)) return byNode.get(nameNode)!;
        byNode.set(nameNode, null);
        const m = callUncached(jf, nameNode);
        byNode.set(nameNode, m);
        return m;
    };
    /** The class whose own instance a qualifier is: `this` and `super` the class around, `Outer.this` Outer; null for any other expression. */
    const selfOf = (jf: JFile, q: number): JType | null => {
        const t = jf.t;
        if (t.type[q] === "this" || t.type[q] === "super") return classAround(jf, q);
        if (t.type[q] !== "field_access" || t.type[child(t, q, "field")] !== "this") return null;
        const v = exprVal(jf, q);
        return v.k === "value" ? v.t : null;
    };
    const callUncached = (jf: JFile, nameNode: number): JMethod | null => {
        const t = jf.t;
        const call = t.parent[nameNode];
        const name = textOf(t, nameNode);
        const k = argCount(t, call);
        const obj = child(t, call, "object");
        const sup = namedChildren(t, call).find((c) => t.type[c] === "super" && t.field[c] !== "object");
        if (sup !== undefined) {
            // `X.super.m()`: interface X's own method, or the superclass's of an outer class X.
            const q = exprVal(jf, obj);
            const X = q.k === "type" && q.res.k === "type" ? q.res.t : null;
            const target = X ? (isIface(X) ? X : superclassOf(X)) : null;
            return target ? pick(jf, nameNode, target, methodsOf(target, name), k, { kind: "self", view: null }) : null;
        }
        if (obj < 0) return unqualified(jf, nameNode, name, k);
        const q = t.type[obj] === "super" ? superVal(jf, obj) : exprVal(jf, obj);
        const T = q.k === "value" ? q.t : q.k === "type" && q.res.k === "type" ? q.res.t : null;
        if (!T) return null;
        const self = selfOf(jf, obj);
        return pick(jf, nameNode, T, methodsOf(T, name), k, self ? { kind: "self", view: self } : q.k === "type" ? { kind: "type" } : { kind: "expr", type: T });
    };

    /** `m(…)`: the innermost class around with a member named m, else the static imports'. */
    const unqualified = (jf: JFile, n: number, name: string, k: number): JMethod | null => {
        for (let s: GScope | null = scopeOf(jf, n); s; s = s.parent) {
            if (s.kind !== "class") continue;
            const T = jf.byNode.get(s.node);
            if (!T) return null;
            const set = methodsOf(T, name);
            if (set.list.length > 0) return pick(jf, n, T, set, k, { kind: "self", view: T });
            if (!set.complete) return null;
        }
        if (gapIn(jf.t, child(jf.t, jf.t.parent[n], "arguments"))) return null;
        const candidates: JMethod[] = [];
        let complete = true;
        for (const i of jf.statics.filter((i) => i.local === name)) {
            const c = fqnType(jf, namesOf(i.spec), true);
            if (c.k !== "type") return null;
            const set = methodsOf(c.t, name);
            if (!set.complete) complete = false;
            candidates.push(...set.list.filter((m) => m.isStatic));
        }
        // A single-static import shadows an on-demand one's method of the same parameter types.
        const singles = candidates.length;
        for (const i of jf.staticStars) {
            const c = fqnType(jf, namesOf(i.spec), true);
            if (c.k !== "type") {
                complete = false;
                continue;
            }
            const set = methodsOf(c.t, name);
            if (!set.complete) complete = false;
            for (const m of set.list) if (m.isStatic && !candidates.slice(0, singles).some((x) => x.n === m.n && x.key() !== null && x.key() === m.key())) candidates.push(m);
        }
        const possible = reachable(candidates.filter((m) => importable(jf, m)), k);
        const args = argTypes(jf, jf.t.parent[n]);
        if (possible.length > 1 && complete) return byArguments(possible, args);
        if (possible.length !== 1 || !mayApply(possible[0], args)) return null;
        // An import not read may hold another; one of no parameter is shadowed by a single import's.
        return complete || (k === 0 && possible[0].n === 0 && !possible[0].varargs && candidates.indexOf(possible[0]) < singles) ? possible[0] : null;
    };

    /**
     * The constructor a creation (`how`: `new`, an anonymous class's, `T::new`)
     * or `this(…)` / `super(…)` with `k` arguments reaches (any number for
     * `T::new`; `call`, the node holding its arguments), as a site names it: a
     * declared one, its class's card standing for it where it has none, or
     * the implicit one, the class's. A protected one of another package only
     * through `super(…)` or an anonymous class (JLS 6.6.2.2).
     */
    const ctorOf = (jf: JFile, n: number, T: JType, k: number | null, how: "new" | "anonymous" | "ref" | "this" | "super", call = -1): Named => {
        if ((T.kind !== "class" && T.kind !== "record") || openOf(T)) return [];
        if (call >= 0 && gapIn(jf.t, child(jf.t, call, "arguments"))) return [];
        const usable = (c: JMethod) => c.access !== "protected" || pkgOf(T) === jf.pkg || how === "super" || how === "anonymous" || how === "this";
        const ctors: JMethod[] = membersOf(T).ctors.filter((c) => (c.access === "protected" ? usable(c) : access(jf, n, c, { kind: "type" }) === "yes"));
        const implicit = (params: () => SType[], count: number, varargs: boolean): JMethod => ({ name: T.name, owner: T, node: -1, unit: T.unit, n: count, varargs, isStatic: false, abstract: false, access: "public", key: () => null, params });
        if (T.kind === "class" && membersOf(T).ctors.length === 0) ctors.push(implicit(() => [], 0, false));
        if (T.kind === "record") {
            // The canonical constructor is implicit unless declared: a compact one, or one taking the components' types.
            const components = recordComponents(T);
            const key = keyOfParams(T.file, components);
            const varargs = components.some((c) => T.file.t.type[c] === "spread_parameter");
            if (!membersOf(T).ctors.some((c) => T.file.t.type[c.node] === "compact_constructor_declaration" || (c.n === components.length && key !== null && c.key() === key))) ctors.push(implicit(lazy(() => paramTypes(T.file, components)), components.length, varargs));
        }
        const possible = reachable(ctors, k);
        const args = call >= 0 ? argTypes(jf, call) : null;
        const one = possible.length > 1 ? (args ? byArguments(possible, args) : null) : possible.length === 1 && (!args || mayApply(possible[0], args)) ? possible[0] : null;
        const unit = one?.unit ?? (one ? T.unit : undefined);
        return unit ? [{ ref: "call", units: [unit], ...(unit !== T.unit && T.unit ? { alt: T.unit } : {}) }] : [];
    };

    const typeOf = (v: Val): JType | null => (v.k === "value" ? v.t : v.k === "type" && v.res.k === "type" ? v.res.t : null);

    /** What a site names, and how. */
    const resolveSite = (f: GFile, s: GSite): Named => {
        const jf = jfileOf(f);
        const t = jf.t;
        const n = s.node;
        // A file of a JDK package (a stub) is no part of a build that has the JDK's.
        if (unsureAt(t, n) || jdkPackage(jf.pkg)) return [];
        const p = t.parent[n];
        const pt = t.type[p];
        const one = (u: Unit | undefined, ref = s.ref): Named => (u ? [{ ref, units: [u] }] : []);
        if (s.ref === "import") {
            const i = f.imports.find((x) => x.node === n);
            if (!i) return [];
            if (jf.singles.includes(i)) {
                const r = fqnType(jf, [...namesOf(i.spec), s.name], true);
                return r.k === "type" ? one(r.t.unit) : [];
            }
            // `import static a.b.C.m;` names every static member m that C declares and the file may use: each overload of m, a member type m.
            const c = fqnType(jf, namesOf(i.spec), true);
            if (c.k !== "type") return [];
            const own = membersOf(c.t);
            const type = own.types.get(s.name);
            const units = [...(own.methods.get(s.name) ?? []).filter((m) => m.isStatic && importable(jf, m)).map((m) => m.unit), ...(type && importable(jf, { access: accessOf(type.file.t, type.node, isIface(c.t)), owner: c.t }) ? [type.unit] : [])];
            const known = [...new Set(units.filter((u): u is Unit => u !== undefined))];
            return known.length > 0 ? [{ ref: s.ref, units: known }] : [];
        }
        // `this(…)`, `super(…)`.
        if (t.type[n] === "this" || t.type[n] === "super") {
            const c = classAround(jf, n);
            const target = c && t.type[n] === "super" ? superclassOf(c) : c;
            return target && !("fqn" in target) ? ctorOf(jf, n, target, argCount(t, p), t.type[n] === "super" ? "super" : "this", p) : [];
        }
        if (pt === "method_invocation" && t.field[n] === "name") return one(callOf(jf, n)?.unit);
        if (pt === "method_reference") {
            const parts = code(t, p);
            if (parts.length > 1 && n === parts[parts.length - 1]) {
                const q = t.type[parts[0]] === "super" ? superVal(jf, parts[0]) : exprVal(jf, parts[0]);
                const T = typeOf(q);
                const self = selfOf(jf, parts[0]);
                return T ? one(pick(jf, n, T, methodsOf(T, s.name), null, self ? { kind: "self", view: self } : q.k === "type" ? { kind: "type" } : { kind: "expr", type: T })?.unit) : [];
            }
            const q = exprVal(jf, n);
            if (q.k !== "type" || q.res.k !== "type") return [];
            // `Foo::new` names the type, and the constructor when it has one.
            return [...one(q.res.t.unit), ...(hasToken(t, p, "new") ? ctorOf(jf, n, q.res.t, null, "ref").map((x) => ({ ...x, ref: s.ref })) : [])];
        }
        // `Outer.Inner` in an expression: a member type, where no field has the name.
        if (pt === "field_access" && t.field[n] === "field") {
            const v = exprVal(jf, p);
            return v.k === "type" && v.res.k === "type" ? one(v.res.t.unit) : [];
        }
        const creation = creationOf(t, n);
        if (creation >= 0 && qualifiedCreation(t, creation)) return [];
        let T: JType | null = null;
        if (t.type[n] === "type_identifier") {
            // A type's name, or its last part after the qualifier's.
            const r = resolveParts(jf, n, typeParts(t, s.shape === "path" ? p : n));
            T = r.k === "type" ? r.t : null;
        } else if (s.shape === "path") {
            // `@a.b.Ann`.
            const r = resolveParts(jf, n, dotted(t, p));
            T = r.k === "type" ? r.t : null;
        } else if (mayBeType(t, n)) {
            // A name before `.` names a type only when no variable has it: `state.read()` names the field state.
            const q = isType(t, n) ? ({ k: "type", res: typeName(jf, n, s.name) } as const) : nameVal(jf, n, s.name);
            T = q.k === "type" && q.res.k === "type" ? q.res.t : null;
        }
        if (!T) return [];
        // `new Foo(…)`, an anonymous `new Foo(…) { … }` too: the type, and the constructor of Foo the arguments reach.
        return creation >= 0 ? [...one(T.unit, "type"), ...ctorOf(jf, n, T, argCount(t, creation), anonymousBody(t, creation) !== undefined ? "anonymous" : "new", creation)] : one(T.unit);
    };

    // A site reaches only a unit of its own name; `this(…)` and `super(…)` a constructor, a record component's name the record's implicit accessor.
    const names = new Set(["this", "super"]);
    for (const f of files) {
        for (const u of f.units) names.add(u.name);
        for (const T of jfileOf(f).byNode.values()) if (T.kind === "record") for (const name of membersOf(T).fields.keys()) names.add(name);
    }
    return (f, s) => (names.has(s.name) ? resolveSite(f, s) : []);
};

export const JAVA_RESOLVER: OwnResolver = { program };
