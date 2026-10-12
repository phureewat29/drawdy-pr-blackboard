/**
 * Which declaration each name refers to, in the files read by rule tables
 * (`anyfacts.ts`): scopes inside a file, imports and package scope between
 * files, and members through what a receiver is known to be.
 *
 * Every answer must be proven: a name resolves only when the scopes, the
 * imports or the receiver's type leave exactly one declaration. A name bound
 * by a local, an unknown receiver, an import the board didn't read, two
 * same-named declarations, or a member that a base outside the files read
 * could hold resolve to nothing, and make no link.
 */

import { scopeAround, type GBinding, type GFile, type GImport, type GScope, type GSite, type Members, type RefKind } from "./anyfacts.ts";
import { memoize, pushTo } from "./fp.ts";
import type { Ref, Unit } from "./langs/pack.ts";
import { textOf, type Flat } from "./syntax.ts";

/** What an expression is, as a language's rules read its syntax. */
export type Hint =
    | { kind: "self" }
    | { kind: "selfclass" }
    | { kind: "super" }
    | { kind: "name"; node: number }
    | { kind: "member"; object: number; name: string }
    | { kind: "path"; qualifier: number; name: string }
    | { kind: "new"; type: number }
    | { kind: "call"; callee: number };

/** A type expression, unwrapped of pointers, references and optionals. */
export type TypeName = { kind: "name"; node: number } | { kind: "qualified"; qualifier: number; name: string } | { kind: "self" };

/** What a module lookup knows of the files: those parsed, their texts (`go.mod`, Python's `__init__.py` files), and whether a path exists, as far as the reads went (undefined: never asked). */
export type ModuleContext = { known: Iterable<string>; text: (path: string) => string | undefined; exists?: (path: string) => boolean | undefined };

/** A field a class-like unit declares, with a written type or a value; `onSelf` when a method sets it on `self`. */
export type Field = { name: string; typeNode: number; init: number; onSelf: boolean };

/** The language hooks the resolver reads, beside the file index's. */
export type Typing = {
    hint: (t: Flat, e: number) => Hint | null;
    typeName: (t: Flat, typeNode: number) => TypeName | null;
    /** A function unit's written result type, its only result or result `index`, or -1. */
    returnType: (t: Flat, unitNode: number, index?: number) => number;
    /** Whether reading a method's name gives its result (Python's `@property`). */
    property?: (t: Flat, unitNode: number) => boolean;
    /** The type a unit belongs to without nesting in it (Go's receiver, the type a Rust impl implements), or -1. */
    ownerType?: (t: Flat, unitNode: number) => number;
    /** Whether a class-like unit holds its members by nesting (Python's classes, Rust's traits) rather than through owner types. */
    nests: (t: Flat, unitNode: number) => boolean;
    /** Whether a unit with an owner type lends it its members: a Rust inherent impl does, a trait impl doesn't. */
    ownsMembers?: (t: Flat, unitNode: number) => boolean;
    /** A type name no declaration read stands for still names one type in its module (Rust): keyed by module and name. */
    moduleNameKeys?: boolean;
    fields?: (t: Flat, unitNode: number) => Field[];
    /** The files sharing one package scope: its key, or null. */
    packageKey?: (path: string, t: Flat) => string | null;
    /** Types are keyed by package and name rather than by declaration (Go). */
    keyByPackage?: boolean;
    /** Whether a file sees another file's package-level names (Go: a `_test.go` file's only from tests). */
    sees?: (from: string, to: string) => boolean;
    /** Whether a member access that isn't a call names a field, never a method (Rust keeps them apart). */
    memberIsField?: (t: Flat, site: number) => boolean;
    /** Whether a name can only be a type or a module where it's written (Rust's path segments). */
    typeOnly?: (t: Flat, site: number) => boolean;
    /** Python: a class's attributes are what its body binds, through its bases in C3 order, and an attribute set on `self` hides a method. */
    mro?: boolean;
    /** Names that are never a repository declaration where they're written bare (`print`, `len`). */
    builtins?: ReadonlySet<string>;
    /** The class-like node whose `self` a node means (a `self` parameter, a `super()` call, Rust's `self` and `Self`), or -1: a class with no unit, inside a function, means no link. Without it, the class unit around. */
    selfClass?: (t: Flat, n: number) => number;
    /** The receiver modes trait methods give each method name (Rust: by value, `&self`, `&mut self`): the files' and the standard library's. */
    traitModes?: (files: readonly GFile[]) => ReadonlyMap<string, ReadonlySet<string>>;
    /** Whether a trait method of one of these modes would answer `x.f()` before this method (Rust's method probe order): then the call names nothing sure. `declared` is the type x's binding writes, or -1. */
    shadowed?: (call: Flat, receiver: number, declared: number, method: Flat, unitNode: number, modes: ReadonlySet<string>) => boolean;
    /** Whether the unit holding a member lends it to the receiver of `x.f` or `T::f` (Rust: an impl for some of a generic type's instances only to a receiver proven one of them). `declared` is the type x's binding writes, or -1. */
    lendsTo?: (call: GFile, receiver: number, declared: number, method: GFile, unitNode: number) => boolean;
    /** Whether a site is a class body's annotation (Python), read after the body ran when annotations are deferred: "deferred" when the file defers them, "unknown" when the Python version decides. */
    deferredAnnotation?: (t: Flat, site: number) => "deferred" | "unknown" | null;
    /** Whether code in one file is built together with a declaration in another (Go's build constraints). */
    reaches?: (from: GFile, to: GFile) => boolean;
    /** The name a module's file gives its module (Go's package clause), which a guessed import name must match. */
    ownName?: (t: Flat) => string | null;
    /** Which names a star import takes from a module (Python: a literal `__all__`, else the public ones), or "unknown" when `__all__` isn't a literal. */
    starNames?: (f: GFile) => ((name: string) => boolean) | "unknown";
    /** Calling a type converts a value (Go): a use, not a call. */
    conversions?: boolean;
};

/** Files the read tier tries in order until one answers, once one of `first` has answered. */
export type ModuleTry = { first?: readonly string[]; files: readonly string[] };

/**
 * What the generic resolver reads of a file's language: its typing hooks,
 * the files a module names among those read (`moduleFiles`), and what the
 * read tier tries for a module (`moduleTries`), else every file
 * `moduleFiles` may name.
 */
export type GenericResolver = {
    typing: Typing;
    moduleFiles: (from: string, spec: string, level: number, ctx: ModuleContext) => string[];
    moduleTries?: (from: string, spec: string, level: number, ctx: ModuleContext) => ModuleTry[];
};

/** What a site names, by how it names it: `new Foo()` uses the type and calls its constructor, whose class's card stands for it where it has none (`alt`). */
export type Named = { ref: RefKind; units: Unit[]; alt?: Unit }[];

/** A language that resolves its own files (Java): given them and what the reads found, what each site names. */
export type OwnResolver = { program: (files: readonly GFile[], ctx: ModuleContext) => (f: GFile, s: GSite) => Named };

export type Resolver = GenericResolver | OwnResolver;

/** Every reference in the files given that names a declaration among them. */
export const resolveAny = (files: readonly GFile[], langOf: (f: GFile) => Resolver, text: (path: string) => string | undefined, exists?: (path: string) => boolean | undefined): Ref[] => {
    const program = createProgram(files.filter((f) => "typing" in langOf(f)), (f) => langOf(f) as GenericResolver, text, exists);
    // A language that resolves its own files gets them all at once.
    const ownProgram = memoize((r: OwnResolver) => r.program(files.filter((g) => langOf(g) === r), { known: files.map((g) => g.path), text, ...(exists ? { exists } : {}) }));
    return files.flatMap((f) => {
        const lang = langOf(f);
        return "typing" in lang ? program.refsOf(f) : ownRefs(f, ownProgram(lang));
    });
};

/** The references of a file whose language resolves its own files. */
const ownRefs = (f: GFile, resolve: (f: GFile, s: GSite) => Named): Ref[] =>
    f.sites.flatMap((s) => resolve(f, s).flatMap(({ ref, units, alt }) => (units.length > 0 ? [{ path: f.path, start: s.start, line: s.line, ref, units, ...(alt ? { alt } : {}) }] : [])));

/** What an expression is known to be. */
type Val =
    | { kind: "unit"; unit: Unit }
    | { kind: "module"; files: GFile[]; spec: string }
    | { kind: "instance"; key: string }
    | { kind: "class"; key: string }
    /** Python's `super()` in a method of the class `key`. */
    | { kind: "super"; key: string }
    | { kind: "none"; why: string };

const NONE = (why: string): Val => ({ kind: "none", why });
const MAX_DEPTH = 40;
const CLASSY = new Set(["class", "type"]);

/** The class-like unit a value is, if it is one. */
const classUnit = (v: Val): Unit | undefined => (v.kind === "unit" && CLASSY.has(v.unit.kind) ? v.unit : undefined);

/** What several files answer for one name: the declaration each of them gives (a package spread over files), or the lone answer; null for several. */
const agreed = (vs: readonly Val[]): Val | null => {
    const first = vs[0]?.kind === "unit" ? vs[0].unit : undefined;
    if (first && vs.every((v) => v.kind === "unit" && v.unit === first)) return vs[0];
    return vs.length === 1 ? vs[0] : null;
};

/** The unit every one of a name's bindings declares: a joined definition binds one unit more than once. */
const unitOfAll = (bs: readonly GBinding[]): Unit | undefined => {
    const first = bs[0]?.unit;
    return first && bs.every((b) => b.unit === first) ? first : undefined;
};

/** The bindings of a name a position sees: a Go or Rust local only after its statement. */
const seenAt = (named: GBinding[] | undefined, at: number): GBinding[] | undefined => (named?.some((b) => b.from !== undefined) ? named.filter((b) => b.from === undefined || b.from <= at) : named);

/** A field, with the file and scope its type is read in. */
type FieldAt = Field & { f: GFile; scope: GScope };

/** A class's method resolution order (Python), `complete` when every base is read. */
type Order = { order: string[]; complete: boolean };

/** C3's merge (Python's MRO): the class, then its bases' orders merged with its bases; the class alone when no order exists. */
const c3 = (key: string, orders: readonly (readonly string[])[], bases: readonly string[]): string[] => {
    const seqs = [...orders.map((o) => [...o]), [...bases]];
    const order = [key];
    for (;;) {
        const live = seqs.filter((q) => q.length > 0);
        if (live.length === 0) return order;
        const head = live.map((q) => q[0]).find((h) => !live.some((q) => q.indexOf(h) > 0));
        if (head === undefined) return [key];
        order.push(head);
        for (const q of live) if (q[0] === head) q.shift();
    }
};

/** What the resolver looks names up in, read once from the files. */
type Index = {
    byPath: ReadonlyMap<string, GFile>;
    /** Each file's package key, where files share a package scope. */
    pkgOf: ReadonlyMap<GFile, string | null>;
    byPackage: ReadonlyMap<string, GFile[]>;
    fileOfUnit: ReadonlyMap<string, GFile>;
    unitById: ReadonlyMap<string, Unit>;
    /** The binding that declares each value unit, for its written type or its value. */
    bindingOfUnit: ReadonlyMap<string, { f: GFile; b: GBinding }>;
    /** The star imports declared in each scope. */
    stars: ReadonlyMap<GScope, GImport[]>;
};

const indexOf = (files: readonly GFile[], typing: (f: GFile) => Typing): Index => {
    const pkgOf = new Map(files.map((f) => [f, typing(f).packageKey?.(f.path, f.flat) ?? null]));
    const byPackage = new Map<string, GFile[]>();
    for (const [f, k] of pkgOf) if (k) pushTo(byPackage, k, f);
    const fileOfUnit = new Map<string, GFile>();
    const unitById = new Map<string, Unit>();
    for (const f of files) {
        for (const u of f.units) {
            fileOfUnit.set(u.id, f);
            unitById.set(u.id, u);
        }
    }
    const bindingOfUnit = new Map<string, { f: GFile; b: GBinding }>();
    for (const f of files) for (const s of f.scopes) for (const bs of s.names.values()) for (const b of bs) if (b.unit?.kind === "value") bindingOfUnit.set(b.unit.id, { f, b });
    const stars = new Map<GScope, GImport[]>();
    for (const f of files) for (const i of f.imports) if (i.name === "*") pushTo(stars, f.importScope.get(i)!, i);
    return { byPath: new Map(files.map((f) => [f.path, f])), pkgOf, byPackage, fileOfUnit, unitById, bindingOfUnit, stars };
};

/**
 * The generic resolver over one review's files: from a site down through
 * names and values, imports and modules, types, and members, which are
 * indexed by type key the first time one is asked for.
 */
const createProgram = (files: readonly GFile[], langOf: (f: GFile) => GenericResolver, text: (path: string) => string | undefined, exists?: (path: string) => boolean | undefined) => {
    const typing = (f: GFile) => langOf(f).typing;
    const { byPath, pkgOf, byPackage, fileOfUnit, unitById, bindingOfUnit, stars } = indexOf(files, typing);
    const parentOf = (u: Unit): Unit | undefined => (u.parent ? unitById.get(u.parent) : undefined);
    const starsIn = (s: GScope): GImport[] => stars.get(s) ?? [];
    // A site resolves only to a unit of its own name, or through an import's local name: no other site can make a link.
    const names = new Set<string>();
    for (const f of files) {
        for (const u of f.units) names.add(u.name);
        for (const i of f.imports) if (i.local) names.add(i.local);
    }

    /** The references a file makes. */
    const refsOf = (f: GFile): Ref[] => {
        const refs: Ref[] = [];
        for (const s of f.sites) {
            if (!names.has(s.name)) continue;
            const u = resolveSite(f, s);
            if (!u || ownType(f, s.start, u)) continue;
            // `T(v)` converts v (Go): it uses the type.
            const ref = typing(f).conversions && s.ref === "call" && CLASSY.has(u.kind) ? "type" : s.ref;
            refs.push({ path: f.path, start: s.start, line: s.line, ref, units: [u] });
        }
        return refs;
    };

    /** The declaration a site names, or null. */
    const resolveSite = (f: GFile, s: GSite): Unit | null => {
        const v = s.ref === "import" ? importSiteVal(f, s) : s.shape === "bare" ? nameVal(f, s.scope, s.name, s.node, s.start, 0) : memberVal(exprVal(f, s.receiver, s.scope, 0), s.name, 0);
        return v.kind === "unit" && kept(f, s, v.unit) ? v.unit : null;
    };

    const importsByNode = memoize((f: GFile) => new Map(f.imports.map((i) => [i.node, i])));

    /** The name an import's site takes. */
    const importSiteVal = (f: GFile, s: GSite): Val => {
        const imp = importsByNode(f).get(s.node);
        return imp ? importVal(f, imp, 0) : NONE("import");
    };

    /** Whether a site still names its declaration once the language's own rules have their say. */
    const kept = (f: GFile, s: GSite, u: Unit): boolean => {
        const ty = typing(f);
        const g = fileOfUnit.get(u.id)!;
        // Only what this file's build holds: a declaration under a build constraint this file doesn't share names nothing.
        if (ty.reaches && !ty.reaches(f, g)) return false;
        // `self.len` names a field where fields and methods are apart, never a method.
        if (s.shape === "member" && s.ref !== "call" && ty.memberIsField?.(f.flat, s.node)) return u.kind !== "function" && u.kind !== "method";
        if (ty.typeOnly?.(f.flat, s.node)) return CLASSY.has(u.kind) || u.kind === "namespace";
        // `x.f()`: a trait's method found at an earlier step of the probe than an inherent one wins (Rust).
        const modes = s.shape === "member" && ty.shadowed ? traitModesOf(ty).get(s.name) : undefined;
        // `x.f`, `T::f`: the unit holding f may lend it to some receivers only (Rust's impls for some of a type's instances).
        const lends = s.shape !== "bare" && ty.lendsTo;
        if (!modes && !lends) return true;
        // A receiver written as a name: the type its one binding declares, a parameter's or a local's.
        const r = s.receiver;
        const declared = r >= 0 && f.flat.type[r] === "identifier" ? (bindingAt(s.scope, textOf(f.flat, r), f.flat.start[r])?.typeNode ?? -1) : -1;
        return (!lends || lends(f, r, declared, g, u.node)) && (!modes || !ty.shadowed!(f.flat, r, declared, g.flat, u.node, modes));
    };

    /** The receiver modes trait methods give each name, for a language. */
    const traitModesOf = memoize((ty: Typing): ReadonlyMap<string, ReadonlySet<string>> => ty.traitModes?.(files.filter((g) => typing(g) === ty)) ?? new Map());

    /** The key of the type a unit belongs to without nesting in it. */
    const ownerKeyOf = memoize((u: Unit): string | null => {
        const f = fileOfUnit.get(u.id)!;
        return typeKey(f, typing(f).ownerType!(f.flat, u.node), scopeAround(f, u.node), 0);
    });

    /**
     * Whether a type is the one the code at an offset belongs to without
     * nesting in it: a Go method's receiver type, the type a Rust impl
     * implements. No string runs from a method to its own type.
     */
    const ownType = (f: GFile, offset: number, target: Unit): boolean => {
        const ownerType = typing(f).ownerType;
        if (!ownerType || !CLASSY.has(target.kind)) return false;
        for (let u = unitAt(f, offset); u; u = parentOf(u)) {
            if (ownerType(f.flat, u.node) < 0) continue;
            return ownerKeyOf(u) === keyOfTypeUnit(target);
        }
        return false;
    };

    /**
     * A name written at node `node`, offset `at`. A class body's annotation
     * read once the body ran (deferred) sees all the body binds; where the
     * Python version decides that, a binding below it makes the name unknown.
     */
    const nameVal = (f: GFile, scope: GScope, name: string, node: number, at: number, depth: number): Val => {
        const deferred = scope.kind === "class" ? typing(f).deferredAnnotation?.(f.flat, node) : null;
        const later = deferred && scope.names.get(name)?.some((b) => b.from !== undefined && b.from > at);
        if (later && deferred === "unknown") return NONE("an annotation the Python version reads");
        return lookup(f, scope, name, depth, later ? Number.MAX_SAFE_INTEGER : at);
    };

    /**
     * The bindings of a name written at offset `at`, innermost scope first. A
     * class body is seen only by the code right in it, and a Go or Rust local
     * only after its statement.
     */
    const lookup = (f: GFile, scope: GScope, name: string, depth: number, at: number): Val => {
        for (let s: GScope | null = scope; s; s = s.parent) {
            const bs = seenAt(s.names.get(name), at);
            if (s.kind === "class" && s !== scope) {
                // Its type parameters are seen inside it, though.
                if (bs?.some((b) => b.kind === "param")) return NONE("type parameter");
                continue;
            }
            if ((!bs || bs.length === 0) && s.kind === "module" && s !== f.module) {
                // An inline module sees its parent only through `use super::*`, and nothing else's glob.
                const ss = starsIn(s);
                if (ss.length === 1 && ss[0].spec === "super") continue;
                return NONE(ss.length > 0 ? "glob import in inline module" : "inline module");
            }
            if (!bs || bs.length === 0) continue;
            if (s.kind === "module") return bindingsVal(f, bs, depth);
            if (bs.some((b) => b.kind === "global")) return topLevel(f, name, depth);
            if (bs.every((b) => b.kind === "nonlocal")) continue;
            return localsVal(f, bs, depth);
        }
        return unboundVal(f, name, depth);
    };

    /** A name a function or a block binds: its value where it is bound once, or where every binding gives the same type. */
    const localsVal = (f: GFile, bs: GBinding[], depth: number): Val => {
        if (bs.length === 1 && (bs[0].kind === "self" || bs[0].kind === "selfclass" || bs[0].typeNode !== undefined || bs[0].init !== undefined)) return localVal(f, bs[0], depth);
        if (bs.length === 1 && bs[0].unit) return { kind: "unit", unit: bs[0].unit };
        if (bs.length === 1 && bs[0].import) return importVal(f, bs[0].import, depth + 1);
        if (bs.length > 1 && bs.every((b) => b.kind === "local" && (b.typeNode !== undefined || b.init !== undefined))) {
            const vs = bs.map((b) => localVal(f, b, depth + 1));
            const keys = new Set(vs.map((v) => (v.kind === "instance" ? v.key : "")));
            if (keys.size === 1 && !keys.has("")) return vs[0];
        }
        return NONE("local");
    };

    /** A name no scope around binds: a builtin, an import with no name written (Go), a star import's, or a package's. */
    const unboundVal = (f: GFile, name: string, depth: number): Val => {
        if (typing(f).builtins?.has(name)) return NONE("builtin");
        // An import with no name written binds the name its module's files give themselves (Go).
        if (typing(f).ownName) {
            const specs = new Set(f.imports.filter((i) => i.implicit).map((i) => i.spec));
            const named = [...specs].map((spec) => moduleOf(f, spec, 0)).filter((mods) => ownNamed(mods, name));
            if (named.length === 1) return { kind: "module", files: named[0], spec: name };
            if (named.length > 1) return NONE("two imports named alike");
        }
        const pk = pkgOf.get(f);
        if (starsIn(f.module).length > 0) return pk ? NONE("star import") : throughStars(f, name, depth + 1);
        return pk ? packageLookup(f, pk, name) : NONE(`unbound ${name}`);
    };

    /** The one binding a name has where it's written, or null: none, or several. */
    const bindingAt = (scope: GScope, name: string, at: number): GBinding | null => {
        for (let s: GScope | null = scope; s; s = s.parent) {
            if (s.kind === "class" && s !== scope) continue;
            const bs = seenAt(s.names.get(name), at);
            if (bs && bs.length > 0) return bs.length === 1 ? bs[0] : null;
        }
        return null;
    };

    /** A local's value: `self`, its written type, or the type of what it was bound to. */
    const localVal = (f: GFile, b: GBinding, depth: number): Val => {
        if (depth > MAX_DEPTH) return NONE("too deep");
        if (b.kind === "self" || b.kind === "selfclass") {
            const cls = selfUnit(f, b.node);
            if (!cls) return NONE("self outside a class");
            return b.kind === "self" ? { kind: "instance", key: selfKey(f, cls) } : { kind: "class", key: selfKey(f, cls) };
        }
        if (b.typeNode !== undefined) {
            // Read where the type is written: a Python parameter's annotation outside its function, as it runs.
            const key = typeKey(f, b.typeNode, scopeAround(f, b.typeNode), depth + 1);
            return key ? { kind: "instance", key } : NONE("type not resolved");
        }
        if (b.init !== undefined) {
            const v = b.initResult !== undefined ? callResult(f, b.init, b.scope, b.initResult, depth + 1) : exprVal(f, b.init, b.scope, depth + 1);
            return v.kind === "instance" || v.kind === "class" || v.kind === "module" ? v : NONE("initializer");
        }
        return NONE("local");
    };

    /** What an expression is. */
    const exprVal = (f: GFile, e: number, scope: GScope, depth: number): Val => {
        if (depth > MAX_DEPTH || e < 0) return NONE("too deep");
        const h = typing(f).hint(f.flat, e);
        if (!h) return NONE("no hint");
        switch (h.kind) {
            case "self":
            case "selfclass":
            case "super": {
                const cls = selfUnit(f, e);
                if (!cls) return NONE("self outside a class");
                const key = selfKey(f, cls);
                return h.kind === "self" ? { kind: "instance", key } : h.kind === "selfclass" ? { kind: "class", key } : { kind: "super", key };
            }
            case "name": {
                const v = lookup(f, scopeAround(f, h.node), textOf(f.flat, h.node), depth + 1, f.flat.start[h.node]);
                const cls = classUnit(v);
                if (cls) return { kind: "class", key: keyOfTypeUnit(cls) };
                if (v.kind === "none" && typing(f).moduleNameKeys) {
                    // A type this module implements but doesn't declare: `T::f()` beside `impl T`.
                    indexMembers();
                    const key = moduleNameKey(f, scopeAround(f, h.node), textOf(f.flat, h.node));
                    if (key && membersByKey.has(key)) return { kind: "class", key };
                }
                // A module-level value: what it was declared or bound to.
                if (v.kind === "unit" && v.unit.kind === "value") {
                    const vb = bindingOfUnit.get(v.unit.id);
                    return vb ? localVal(vb.f, vb.b, depth + 1) : NONE("value");
                }
                return v;
            }
            case "member": {
                const v = memberVal(exprVal(f, h.object, scope, depth + 1), h.name, depth + 1);
                if (v.kind !== "unit") return v;
                // A property reads as its result.
                const g = fileOfUnit.get(v.unit.id)!;
                return typing(g).property?.(g.flat, v.unit.node) ? resultOf(v.unit, undefined, depth) : v;
            }
            case "path":
                return memberVal(exprVal(f, h.qualifier, scope, depth + 1), h.name, depth + 1);
            case "new": {
                const key = typeKey(f, h.type, scopeAround(f, h.type), depth + 1);
                return key ? { kind: "instance", key } : NONE("new of unknown type");
            }
            case "call": {
                const callee = exprVal(f, h.callee, scope, depth + 1);
                if (callee.kind === "class") return { kind: "instance", key: callee.key };
                const cls = classUnit(callee);
                if (cls) return { kind: "instance", key: keyOfTypeUnit(cls) };
                return callee.kind === "unit" ? resultOf(callee.unit, undefined, depth) : NONE("callee unknown");
            }
        }
    };

    /** What `obj.name` is, given what obj is. */
    const memberVal = (obj: Val, name: string, depth: number): Val => {
        if (obj.kind === "module") {
            const vs = obj.files.map((g) => topLevel(g, name, depth + 1)).filter((v) => v.kind !== "none");
            const answer = agreed(vs);
            if (answer) return answer;
            // A submodule: `pkg.sub`.
            const sub = vs.length === 0 ? moduleOf(obj.files[0], `${obj.spec}.${name}`, 0) : [];
            return sub.length > 0 ? { kind: "module", files: sub, spec: `${obj.spec}.${name}` } : NONE("module member");
        }
        // `super()` reads the class attributes after the class's own.
        if (obj.kind === "super") return memberOf(obj.key, name, depth + 1, 1);
        if (obj.kind === "instance" || obj.kind === "class") {
            const m = memberOf(obj.key, name, depth + 1);
            if (obj.kind === "instance" && bodyOf.has(obj.key) && m.kind === "unit" && fieldsOf(obj.key).some((x) => x.onSelf && x.name === name)) return NONE("attribute set on self");
            if (m.kind === "unit" || obj.kind === "class") return m;
            const fv = fieldVal(obj.key, name, depth + 1);
            return fv.kind !== "none" ? fv : m;
        }
        const cls = classUnit(obj);
        if (cls) return memberVal({ kind: "class", key: keyOfTypeUnit(cls) }, name, depth);
        return NONE("receiver unknown");
    };

    /** An instance of a function unit's written result type, result `index`. */
    const resultOf = (u: Unit, index: number | undefined, depth: number): Val => {
        const g = fileOfUnit.get(u.id)!;
        const rt = typing(g).returnType(g.flat, u.node, index);
        if (rt < 0) return NONE("no result type");
        const key = typeKey(g, rt, scopeAround(g, rt), depth + 1);
        return key ? { kind: "instance", key } : NONE("result type unknown");
    };

    /** Result `index` of a call: the callee's written result type. */
    const callResult = (f: GFile, e: number, scope: GScope, index: number, depth: number): Val => {
        const h = typing(f).hint(f.flat, e);
        if (!h || h.kind !== "call") return NONE("not a call");
        const callee = exprVal(f, h.callee, scope, depth + 1);
        return callee.kind === "unit" ? resultOf(callee.unit, index, depth) : NONE("callee unknown");
    };

    /** What an import binds: its module, a name the module binds, or a submodule of it. */
    const importVal = (f: GFile, imp: GImport, depth: number): Val => {
        if (depth > MAX_DEPTH) return NONE("import chain too deep");
        if (imp.unproven) return NONE("sys.path may have moved");
        const mods = moduleOf(f, imp.spec, imp.level);
        // A name guessed from the path binds only where the module calls itself so.
        if (imp.implicit && !ownNamed(mods, imp.local)) return NONE("the module's own name differs");
        if (imp.name === null) return mods.length > 0 ? { kind: "module", files: mods, spec: imp.spec } : NONE(`module ${imp.spec} not read`);
        if (imp.name === "*") return NONE("star");
        const found: Val[] = [];
        for (const m of mods) {
            const v = topLevel(m, imp.name, depth);
            if (v.kind !== "none") found.push(v);
        }
        const sub = moduleOf(f, imp.spec ? `${imp.spec}.${imp.name}` : imp.name, imp.level).filter((g) => !mods.includes(g));
        const answer = sub.length === 0 ? agreed(found) : null;
        if (answer) return answer;
        if (found.length === 0 && sub.length > 0) return { kind: "module", files: sub, spec: `${imp.spec}.${imp.name}` };
        return NONE(found.length + sub.length === 0 ? `import ${imp.spec}:${imp.name} not read` : "import ambiguous");
    };

    /** What a module-level name of a file is, following imports. */
    const topLevel = (f: GFile, name: string, depth: number): Val => {
        const bs = (f.module.names.get(name) ?? []).filter((b) => b.kind !== "global" && b.kind !== "nonlocal");
        if (bs.length > 0) return bindingsVal(f, bs, depth);
        if (starsIn(f.module).length > 0) return throughStars(f, name, depth + 1);
        const pk = pkgOf.get(f);
        return pk ? packageLookup(f, pk, name) : NONE(`no ${name} in ${f.path}`);
    };

    /** What some bindings of one name in one scope are: one unit, or one import or value, else unknown. */
    const bindingsVal = (f: GFile, bs: GBinding[], depth: number): Val => {
        // A star import after the binding, in its scope, may replace it.
        const lastStar = Math.max(-1, ...starsIn(bs[0].scope).map((i) => f.flat.start[i.stmt]));
        if (bs.some((b) => f.flat.start[b.node] < lastStar)) return NONE("star import after it");
        // `import a` and `import a.b` both bind the package a.
        const unit = unitOfAll(bs);
        if (unit) return { kind: "unit", unit };
        const first = bs[0].import;
        if (first?.name === null && bs.every((b) => b.import?.name === null && b.import.spec === first.spec && b.import.level === first.level)) return importVal(f, first, depth + 1);
        if (bs.length !== 1) return NONE("bound more than once");
        const b = bs[0];
        if (b.import) return importVal(f, b.import, depth + 1);
        if (b.typeNode !== undefined || b.init !== undefined) return localVal(f, b, depth + 1);
        return NONE(`${b.kind} binding`);
    };

    /** A name a module's star imports bring in: known only when every star module is read and exactly one declares it. */
    const throughStars = (f: GFile, name: string, depth: number): Val => {
        if (depth > MAX_DEPTH) return NONE("too deep");
        const found: Val[] = [];
        for (const i of starsIn(f.module)) {
            if (i.unproven) return NONE("sys.path may have moved");
            const mods = moduleOf(f, i.spec, i.level);
            if (mods.length === 0) return NONE("star import not read");
            for (const m of mods) {
                // What the star takes: `__all__`, or the public names.
                const takes = typing(m).starNames?.(m);
                if (takes === "unknown") return NONE("star import's __all__ not literal");
                if (takes && !takes(name)) continue;
                const v = topLevel(m, name, depth + 1);
                if (v.kind !== "none") found.push(v);
                else if (v.why === "star import" || v.why === "star import not read" || v.why === "star ambiguous") return NONE("star import not read");
            }
        }
        return agreed(found) ?? NONE(found.length > 1 ? "star ambiguous" : `no ${name} in ${f.path}`);
    };

    /** A name through the other files of a package that this one sees: one unit, or nothing. */
    const packageLookup = (f: GFile, pk: string, name: string): Val => {
        const { sees, reaches } = typing(f);
        const units: Unit[] = [];
        let other = 0;
        // Of twins for different builds, the one this file's build holds.
        for (const g of byPackage.get(pk) ?? []) {
            if (g === f || (sees && !sees(f.path, g.path)) || (reaches && !reaches(f, g))) continue;
            for (const b of g.module.names.get(name) ?? []) {
                if (b.kind === "import") continue;
                if (b.unit) units.push(b.unit);
                else other++;
            }
        }
        const uniq = [...new Set(units)];
        if (uniq.length === 1 && other === 0) return { kind: "unit", unit: uniq[0] };
        return NONE(uniq.length > 1 ? "several in package" : "not in package files read");
    };

    // One context for every lookup: what a lookup learns from the paths known holds for all of them.
    const lookupContext: ModuleContext = { known: [...byPath.keys()], text, ...(exists ? { exists } : {}) };
    const modules = new Map<string, GFile[]>();

    /** The files a module names, among those read. */
    const moduleOf = (from: GFile, spec: string, level: number): GFile[] => {
        const key = `${from.path}\n${spec}\n${level}`;
        let hit = modules.get(key);
        if (!hit) {
            hit = [];
            for (const c of langOf(from).moduleFiles(from.path, spec, level, lookupContext)) {
                const g = byPath.get(c);
                if (g && !hit.includes(g)) hit.push(g);
            }
            modules.set(key, hit);
        }
        return hit;
    };

    /** Whether a module's files all give it one name, the one asked (Go's package clause). */
    const ownNamed = (mods: readonly GFile[], name: string) => mods.length > 0 && mods.every((g) => typing(g).ownName?.(g.flat) === name);

    /** The key of the type a type expression names, or null. */
    const typeKey = (f: GFile, typeNode: number, scope: GScope, depth: number): string | null => {
        if (depth > MAX_DEPTH) return null;
        const tn = typing(f).typeName(f.flat, typeNode);
        if (!tn) return null;
        if (tn.kind === "self") {
            const cls = selfUnit(f, typeNode);
            return cls ? selfKey(f, cls) : null;
        }
        if (typing(f).keyByPackage) return packageTypeKey(f, tn, scope, depth);
        const v = tn.kind === "name" ? nameVal(f, scope, textOf(f.flat, tn.node), tn.node, f.flat.start[tn.node], depth + 1) : memberVal(exprVal(f, tn.qualifier, scope, depth + 1), tn.name, depth + 1);
        if (v.kind === "class") return v.key;
        const cls = classUnit(v);
        if (cls) return keyOfTypeUnit(cls);
        if (tn.kind === "name" && typing(f).moduleNameKeys && v.kind === "none") return moduleNameKey(f, scope, textOf(f.flat, tn.node));
        return null;
    };

    /** Go: a type is its package and its name, unless a function declares its own. */
    const packageTypeKey = (f: GFile, tn: Exclude<TypeName, { kind: "self" }>, scope: GScope, depth: number): string | null => {
        if (tn.kind === "name") {
            const name = textOf(f.flat, tn.node);
            for (let s: GScope | null = scope; s && s !== f.module; s = s.parent) if (s.names.has(name)) return null;
            const pk = pkgOf.get(f);
            return pk ? `${pk}#${name}` : null;
        }
        const q = exprVal(f, tn.qualifier, scope, depth + 1);
        if (q.kind !== "module") return null;
        const pk = q.files.map((g) => pkgOf.get(g)).find((k) => k);
        return pk ? `${pk}#${tn.name}` : null;
    };

    /** A type no declaration read stands for, named inside its module: the module scope and the name. */
    const moduleNameKey = (f: GFile, scope: GScope, name: string): string | null => {
        let s: GScope | null = scope;
        while (s && s.kind !== "module") {
            if (s.names.has(name)) return null;
            s = s.parent;
        }
        return s ? `${f.path}#${s.id}#${name}` : null;
    };

    /** A type's key: its declaration's id, or `package#Name` where types are named by package. */
    const keyOfTypeUnit = (u: Unit): string => {
        const f = fileOfUnit.get(u.id)!;
        const pk = pkgOf.get(f);
        return typing(f).keyByPackage && pk ? `${pk}#${u.name}` : u.id;
    };

    /** The key of the type `self` stands for inside a class-like unit: the type an impl implements, else the class. */
    const selfKey = (f: GFile, cls: Unit): string => {
        const owner = typing(f).ownerType?.(f.flat, cls.node) ?? -1;
        if (owner >= 0) return typeKey(f, owner, scopeAround(f, cls.node), 0) ?? `?${cls.id}`;
        return keyOfTypeUnit(cls);
    };

    /** The class-like unit whose `self` a node means: by the language's rule where it has one, so that a class inside a function, which is no unit, means none. */
    const selfUnit = (f: GFile, n: number): Unit | undefined => {
        const rule = typing(f).selfClass;
        if (!rule) return classAround(f, f.flat.start[n]);
        const node = rule(f.flat, n);
        const u = node >= 0 ? f.unitByNode.get(node) : undefined;
        return u && CLASSY.has(u.kind) ? u : undefined;
    };

    const classAround = (f: GFile, offset: number): Unit | undefined => {
        for (let u = unitAt(f, offset); u; u = parentOf(u)) if (CLASSY.has(u.kind)) return u;
        return undefined;
    };

    /** The innermost unit of a file holding an offset: units nest, so it is the last to start at or before it, or a unit around that one. */
    const unitAt = (f: GFile, offset: number): Unit | undefined => {
        const us = f.units;
        let lo = 0;
        let hi = us.length - 1;
        let at = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (us[mid].start <= offset) {
                at = mid;
                lo = mid + 1;
            } else hi = mid - 1;
        }
        for (let u = at >= 0 ? us[at] : undefined; u; u = parentOf(u)) if (offset < u.end) return u;
        return undefined;
    };

    /**
     * A member of a type by key. Python: the first class in its order whose
     * body binds it, from `skip` on, while the order is sure. Elsewhere:
     * declared on the type. A Go struct's embedded types lend it methods, but
     * a method of its own, in a file of the package not read, would win: so
     * none is taken from them.
     */
    const memberOf = (key: string, name: string, depth: number, skip = 0): Val => {
        indexMembers();
        if (depth > MAX_DEPTH) return NONE("too deep");
        if (bodyOf.has(key)) {
            const { order, complete } = linearize(key, depth + 1);
            for (const k of order.slice(skip)) {
                const v = bodyAttr(k, name);
                if (v) return v;
            }
            return NONE(complete ? "no member" : "base not resolved");
        }
        const own = membersByKey.get(key)?.get(name);
        if (own && own.length > 0) return own.length > 1 ? NONE("overloaded") : { kind: "unit", unit: own[0] };
        return NONE(membersByKey.has(key) ? "no member" : "type not read");
    };

    /** Python: what a class's own body binds of a name; undefined when it binds nothing. */
    const bodyAttr = (key: string, name: string): Val | undefined => {
        const bs = bodyOf.get(key)?.names.get(name);
        if (!bs || bs.length === 0) return undefined;
        const unit = unitOfAll(bs);
        return unit ? { kind: "unit", unit } : NONE("class attribute");
    };

    /**
     * Python: a class's method resolution order (C3), `complete` when every
     * base is read. With a base not read, only its start is sure: the class,
     * then its one base's order, or its first base alone, which C3 always
     * puts right after it.
     */
    const mros = new Map<string, Order>();
    const linearize = (key: string, depth: number): Order => {
        const hit = mros.get(key);
        if (hit) return hit;
        const unsure: Order = { order: [key], complete: false };
        // A cycle reads as unsure.
        mros.set(key, unsure);
        if (depth > MAX_DEPTH) return unsure;
        const bases: (string | null)[] = [];
        for (const b of basesByKey.get(key) ?? []) for (const n of b.nodes) bases.push(typeKey(b.f, n, b.scope, depth + 1));
        const orders = bases.map((k) => (k && bodyOf.has(k) ? linearize(k, depth + 1) : null));
        let found: Order;
        if (orders.every((o) => o?.complete)) {
            // Every base is read: C3, unless no order exists.
            const order = c3(key, orders.map((o) => o!.order), bases.map((k) => k!));
            found = { order, complete: order.length > 1 || bases.length === 0 };
        } else if (orders.length === 1 && orders[0]) found = { order: [key, ...orders[0].order], complete: false };
        else found = { order: orders[0] ? [key, bases[0]!] : [key], complete: false };
        mros.set(key, found);
        return found;
    };

    /** The fields of a type, and in Python of every class in its order. */
    const fieldsOf = (key: string): FieldAt[] => (bodyOf.has(key) ? linearize(key, 0).order : [key]).flatMap((k) => fieldsByKey.get(k) ?? []);

    /** A field's value on an instance of a type: its written type or its value's; a type written in a class body wins over what methods set. */
    const fieldVal = (key: string, name: string, depth: number): Val => {
        const all = fieldsOf(key).filter((x) => x.name === name);
        const declared = all.filter((x) => !x.onSelf && x.typeNode >= 0);
        const fs = declared.length > 0 ? declared : all;
        if (fs.length === 0) return NONE("no field");
        const keys = new Set<string>();
        for (const fd of fs) {
            const k = fd.typeNode >= 0 ? typeKey(fd.f, fd.typeNode, fd.scope, depth + 1) : null;
            const v: Val = k ? { kind: "instance", key: k } : fd.typeNode < 0 && fd.init >= 0 ? exprVal(fd.f, fd.init, fd.scope, depth + 1) : NONE("field type");
            if (v.kind !== "instance") return NONE("field not typed");
            keys.add(v.key);
        }
        return keys.size === 1 ? { kind: "instance", key: [...keys][0] } : NONE("field typed twice");
    };

    // Members by type key: nested ones from class bodies, owned ones from receivers and impls.
    const membersByKey = new Map<string, Members>();
    const basesByKey = new Map<string, { f: GFile; scope: GScope; nodes: number[] }[]>();
    const fieldsByKey = new Map<string, FieldAt[]>();
    /** Python: each class's body, whose bindings are its attributes. */
    const bodyOf = new Map<string, GScope>();
    const addMember = (key: string, u: Unit) => {
        let m = membersByKey.get(key);
        if (!m) membersByKey.set(key, (m = new Map()));
        pushTo(m, u.name, u);
    };
    // Set before indexing: an owner type's key, read while indexing, sees the members indexed so far.
    let indexed = false;
    const indexMembers = () => {
        if (indexed) return;
        indexed = true;
        for (const f of files) {
            const ty = typing(f);
            for (const u of f.units) {
                const owner = ty.ownerType?.(f.flat, u.node) ?? -1;
                if (CLASSY.has(u.kind) && owner < 0) {
                    const key = keyOfTypeUnit(u);
                    if (!membersByKey.has(key)) membersByKey.set(key, new Map());
                    if (ty.nests(f.flat, u.node)) for (const us of f.members.get(u.id)?.values() ?? []) for (const x of us) addMember(key, x);
                    const scope = scopeAround(f, u.node);
                    const b = f.bases.get(u.id);
                    if (b) pushTo(basesByKey, key, { f, scope, nodes: b });
                    // A field's type is read where it is written: a class body's own names, a generic type's parameters.
                    for (const fd of ty.fields?.(f.flat, u.node) ?? []) pushTo(fieldsByKey, key, { f, scope: fd.typeNode >= 0 ? scopeAround(f, fd.typeNode) : scope, ...fd });
                    const body = f.scopeOfNode.get(u.node);
                    if (ty.mro && body) bodyOf.set(key, body);
                }
                if (owner >= 0 && ty.ownsMembers?.(f.flat, u.node) !== false) {
                    const key = typeKey(f, owner, scopeAround(f, u.node), 0);
                    if (!key) continue;
                    if (u.kind === "function" || u.kind === "method") addMember(key, u);
                    // An impl block: its methods belong to the type it implements.
                    else if (CLASSY.has(u.kind)) for (const us of f.members.get(u.id)?.values() ?? []) for (const x of us) addMember(key, x);
                }
            }
        }
    };

    return { refsOf };
};
