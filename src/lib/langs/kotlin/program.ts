/**
 * Kotlin's names, resolved where the files read prove them (the Kotlin spec's
 * "Declarations > Scopes and identifiers" and "Overload resolution"; checked
 * against kotlinc 2.4's resolution by probes).
 *
 * A bare name is looked up through levels, innermost first: locals, then
 * each implicit receiver (a lambda's, an extension's, each class around,
 * its companion and its supertypes' companions), then the file: explicit
 * imports, the package, star imports, the default imports. A call takes the
 * first level with a candidate that applies. So a link needs every level
 * before its target's to be known to hold no candidate: a receiver whose
 * members the reads can't list (a supertype not read, a library type, a
 * lambda whose receiver nobody wrote) stops the lookup. Its target must
 * surely apply, or be the only candidate of the whole chain: a declaration
 * of the default imports or of a star import nobody read may take a call its
 * target doesn't apply to.
 *
 * What a declaration in a file not read could change (an overload, an
 * extension, a class of the same name in the same package) is out of reach;
 * what the files read point to and the board didn't read draws nothing.
 */

import type { GFile, GSite } from "../../anyfacts.ts";
import type { ModuleContext, Named } from "../../anylink.ts";
import { child, type Flat } from "../../syntax.ts";
import type { Unit } from "../pack.ts";
import { argOf, callAround, callOf, code, kid, modifiersOf, nameOf, navOf, nullable, stripType, text, token, TYPE_NODES, typeParts, type Call } from "./nodes.ts";
import { isClass, outlineOf, paramsOf, type ClassDecl, type Decl, type Import, type Outline, type Param } from "./outline.ts";
import { commonSet, rootOf, unseen } from "./roots.ts";
import { castersOfText, castersOfTree, declaredNames, javaClasses, misread, packageOfText } from "./doubt.ts";
import { LIB_MEMBERS, LIB_NAMES, LIB_STARS } from "./library.ts";
import { STD_ANY_EXT, STD_CLASSES, STD_LAMBDAS, STD_TOP } from "./stdlib.ts";

type KFile = { g: GFile; t: Flat; path: string; o: Outline; doubt: boolean; unhides: boolean };
type KClass = { f: KFile; d: ClassDecl; fqn: string };
type KDecl = { f: KFile; d: Decl };
/** Where a name is looked up: its file and node, and whether a member is reached through `this` (an implicit receiver, `this.`). */
type At = { f: KFile; n: number; viaThis: boolean };

/** What a value is known to be: a class read, a type of the default imports, or a type parameter. */
type Ty = { k: "class"; c: KClass; nullable: boolean } | { k: "std"; name: string; nullable: boolean } | { k: "lib"; name: string; nullable: boolean } | { k: "param"; nullable: boolean };

type Verdict = "sure" | "maybe" | "no";

/** A level of a lookup: its candidates, and whether more may hide there (unknown). */
/**
 * A level of a lookup: its candidates; whether more may hide there
 * (unknown); candidates whose visibility there is unknown (hidden: one that
 * may apply stops the lookup); and whether something the reads can't judge
 * may apply there (weak: a property's `invoke`), so only a candidate that
 * surely applies wins.
 */
type Level = { cands: KDecl[]; unknown: boolean; why?: string; hidden?: KDecl[]; weak?: boolean; fit?: Map<Decl, Verdict> };

const stop = (why: string): Level => ({ cands: [], unknown: true, why });

/** Why the last lookup drew nothing, for the tools (none set in the product). */
export const trace: { why: ((s: string) => void) | null } = { why: null };

/** Members every class has from `Any`. */
const ANY_MEMBERS = new Set(["equals", "hashCode", "toString"]);
/** Members an enum class has besides its own, and its companion-like statics. */
/** Kotlin libraries that declare no contract: assertk (checked at its source). */
const CONTRACT_FREE = /^assertk(\.|$)/;

/** The known libraries' functions whose contract implies a type, whatever their type arguments: kotlin.test's `assertIs` (`returns() implies (value is T)`); the standard library's and kotlinx.coroutines' imply none. */
const LIB_CASTERS = new Set(["assertIs"]);

/** The standard library's operator and infix functions, members or extensions, none with a contract. */
const STD_OPS = new Set("and component1 component2 component3 component4 component5 contains contentDeepEquals contentEquals dec downTo inc intersect iterator matches not or rangeTo rangeUntil shl shr step subtract then thenDescending to unaryMinus unaryPlus union until ushr xor zip".split(" "));

/** Packages of Java code alone, whose methods carry no Kotlin contract. */
const JAVA_ONLY = /^(java|javax|android|org\.junit\.(Assert|Assume|jupiter\.api\.(Assertions|Assumptions))|org\.assertj|com\.google\.common|org\.hamcrest)\./;

/** What an enum class itself holds, before its companion's members. */
const ENUM_STATICS = new Set(["values", "valueOf", "entries"]);
const ENUM_MEMBERS = new Set(["name", "ordinal", "compareTo", "values", "valueOf", "entries", "declaringJavaClass", "getDeclaringClass", "describeConstable", "finalize", "clone"]);
/** Members a data class has besides its own. */
const DATA_MEMBER = /^(copy|component\d+)$/;

/** The default imports' types a literal can be, by literal. */
const LITERALS: Record<string, string[]> = {
    string_literal: ["String", "CharSequence", "Comparable", "Any"],
    multiline_string_literal: ["String", "CharSequence", "Comparable", "Any"],
    character_literal: ["Char", "Comparable", "Any"],
};

/**
 * The standard types a literal may be, the one it is without an expected
 * type first: `1` an Int (a Long when too big), or a Long, a Short or a Byte
 * a parameter asks for; `1L` a Long; `1u` an unsigned one (`1uL` a ULong);
 * `1.0` a Double, `1f` a Float. Null for no literal.
 */
const literalTypes = (t: Flat, v: number): string[] | null => {
    const ty = t.type[v];
    if (LITERALS[ty]) return LITERALS[ty];
    const s = text(t, v).replace(/_/g, "");
    if (ty === "float_literal") return /[fF]$/.test(s) ? ["Float", "Number", "Comparable", "Any"] : ["Double", "Number", "Comparable", "Any"];
    if (ty !== "number_literal") return null;
    if (/[uU][lL]$/.test(s)) return ["ULong", "Comparable", "Any"];
    if (/[uU]$/.test(s)) return beyond(s.slice(0, -1), 0xffffffffn) ? ["ULong", "Comparable", "Any"] : ["UInt", "ULong", "UShort", "UByte", "Comparable", "Any"];
    if (/[lL]$/.test(s)) return ["Long", "Number", "Comparable", "Any"];
    return beyond(s, 0x7fffffffn) ? ["Long", "Number", "Comparable", "Any"] : ["Int", "Long", "Short", "Byte", "Number", "Comparable", "Any"];
};

/** Supertypes of a literal's type besides those it lists: a number, a character or a string is Serializable (and a java.lang.Object, if written). */
const LITERAL_SUPERS = new Set(["Serializable", "java.io.Serializable", "Object", "Comparable"]);

/** Whether an integer literal's digits (`0x…`, `0b…`, decimal) are above a bound; unreadable ones are. */
const beyond = (digits: string, bound: bigint): boolean => {
    try {
        return BigInt(digits.replace(/^0[bB]/, "0b").replace(/^0[xX]/, "0x")) > bound;
    } catch {
        return true;
    }
};

/** Declarations whose bodies are code: a name inside one is a local's or a member's. */
/**
 * Where a node sits in a class-like declaration: its body; its constructor
 * part (the primary constructor, a supertype's constructor arguments, a
 * delegate after `by`), which sees the class's nested classes and its
 * static scope's companions, not its instance; or the rest of its header
 * (the supertypes' names, annotations, type parameters: they see neither).
 */
const placeIn = (t: Flat, cls: number, n: number): "body" | "ctor" | "header" => {
    for (let x = n; x >= 0 && x !== cls; x = t.parent[x]) {
        if (t.parent[x] !== cls) continue;
        const ty = t.type[x];
        if (ty === "class_body" || ty === "enum_class_body") return "body";
        if (ty === "primary_constructor") return "ctor";
        if (ty === "delegation_specifiers" || ty === "delegation_specifier") {
            for (let y = n; y >= 0 && y !== x; y = t.parent[y]) {
                const p = t.parent[y];
                if (t.type[y] === "value_arguments" && t.type[p] === "constructor_invocation") return "ctor";
                if (t.type[p] === "explicit_delegation" && !TYPE_NODES.has(t.type[y])) return "ctor";
            }
        }
        return "header";
    }
    return "body";
};

const FUNCTIONS = new Set(["function_declaration", "anonymous_function", "secondary_constructor", "getter", "setter", "anonymous_initializer", "lambda_literal"]);
const CLASS_LIKE = new Set(["class_declaration", "object_declaration", "companion_object", "object_literal", "enum_entry"]);

/** An expression without parentheses, `!!` and a prefix operator (tree-sitter reads `!x.f()` as `(!x).f()`). */
const unwrap = (t: Flat, e: number): number => {
    let x = e;
    while (x >= 0 && (t.type[x] === "parenthesized_expression" || t.type[x] === "unary_expression")) x = code(t, x)[0] ?? -1;
    return x;
};

/** The last name a value is read by: `x`, `prop` of `a.b.prop` or `a?.prop`, `this`; null for any other expression. */
const lastName = (t: Flat, x: number): string | null => {
    if (t.type[x] === "identifier") return nameOf(t, x);
    if (t.type[x] === "this_expression") return "this";
    if (t.type[x] === "navigation_expression") {
        const nav = navOf(t, x);
        return nav && nav.op !== "::" ? nameOf(t, nav.name) : null;
    }
    return null;
};

/** The name an import gives what it imports: its alias, else its last segment. */
const importName = (i: Import): string => i.alias ?? i.path[i.path.length - 1];

/** A file's imports of a name, star imports aside. */
const importsOf = (f: { o: Outline }, name: string): Import[] => f.o.imports.filter((i) => !i.star && importName(i) === name);

/** A property declaration's initializer: the expression after its `=`. */
const initOf = (t: Flat, d: number): number => {
    for (let y = t.first[d], eq = false; y >= 0; y = t.next[y]) {
        if (!t.named[y] && t.type[y] === "=") eq = true;
        else if (eq && t.named[y]) return y;
    }
    return -1;
};

/** The code a node stands in: its innermost function, accessor or initializer (-1: none); a lambda run in place may pass a cast out, so it's not one. */
const innermostCode = (t: Flat, n: number): number => {
    for (let x = t.parent[n]; x >= 0; x = t.parent[x]) if (FUNCTIONS.has(t.type[x]) && t.type[x] !== "lambda_literal") return x;
    return -1;
};

/** A binary expression's operator, as written. */
const operatorOf = (t: Flat, x: number): string => {
    const o = child(t, x, "operator");
    return o >= 0 ? text(t, o) : "";
};

/** The operators whose functions may have a contract (kotlinc refuses one on `plus`, `get`, `compareTo`, `plusAssign`, `getValue` and the like), by how they're written. */
const UNARY: Record<string, string> = { "-": "unaryMinus", "+": "unaryPlus", "!": "not", "++": "inc", "--": "dec" };

/**
 * The call an operator or an infix name makes at a node, as `recv.name(args)`:
 * `x isA T`, `x in box` (`box.contains(x)`), `in box` of a `when` entry (the
 * subject aside), `a..b`, `-x`, `for (i in xs)` (`xs.iterator()`), `val (a, b)
 * = x` (`x.component1()` and on: name `component`). A prefix operator
 * tree-sitter read onto a receiver (`!x.f()` as `(!x).f()`) applies to the
 * whole chain. Null for none.
 */
const opCallOf = (t: Flat, x: number): { name: string; recv: number; args: number[] } | null => {
    const kids = code(t, x);
    switch (t.type[x]) {
        case "infix_expression":
            return kids.length === 3 && t.type[kids[1]] === "identifier" ? { name: nameOf(t, kids[1]), recv: kids[0], args: [kids[2]] } : null;
        case "in_expression":
            return kids.length === 2 ? { name: "contains", recv: kids[1], args: [kids[0]] } : null;
        case "range_test":
            return kids.length === 1 ? { name: "contains", recv: kids[0], args: [] } : null;
        case "range_expression":
            return kids.length === 2 ? { name: token(t, x, "..<") >= 0 ? "rangeUntil" : "rangeTo", recv: kids[0], args: [kids[1]] } : null;
        case "unary_expression": {
            const name = UNARY[operatorOf(t, x)];
            if (!name) return null;
            let top = x;
            while (t.parent[top] >= 0 && /^(navigation|call|indexing)_expression$/.test(t.type[t.parent[top]]) && code(t, t.parent[top])[0] === top) top = t.parent[top];
            return { name, recv: top === x ? child(t, x, "argument") : top, args: [] };
        }
        case "for_statement": {
            const at = token(t, x, "in");
            const iter = kids.find((c) => at >= 0 && t.start[c] > t.start[at]) ?? -1;
            return iter >= 0 ? { name: "iterator", recv: iter, args: [] } : null;
        }
        case "property_declaration": {
            const init = initOf(t, x);
            return kid(t, x, "multi_variable_declaration") >= 0 && init >= 0 ? { name: "component", recv: init, args: [] } : null;
        }
    }
    return null;
};

/** Where an identifier names no value read: a declaration's, a type's, a label's, a call's or an infix call's function, a named argument's parameter. */
const NOT_READ = new Set(["user_type", "variable_declaration", "parameter", "class_parameter", "function_declaration", "type_alias", "label", "this_expression", "super_expression", "callable_reference", "annotation", "constructor_invocation", "type_parameter", "call_expression", "class_declaration", "object_declaration", "enum_entry", "lambda_parameters"]);

/**
 * Whether an identifier reads a value by its name alone: not a member's name
 * after a dot, nor a name of `NOT_READ`, nor a literal tree-sitter reads as
 * one (`null`, `true`), nor code in an annotation (never run), nor a call
 * with type arguments tree-sitter read as comparisons (`(f < T) > {}`: f, T).
 */
const valueRead = (t: Flat, x: number): boolean => {
    const p = t.parent[x];
    if (p < 0 || NOT_READ.has(t.type[p]) || /^(null|true|false|break|continue)$/.test(text(t, x))) return false;
    for (let a = p; a >= 0 && !FUNCTIONS.has(t.type[a]); a = t.parent[a]) if (t.type[a] === "annotation") return false;
    if (t.type[p] === "binary_expression" && operatorOf(t, p) === "<" && t.parent[p] >= 0 && genericRead(t, t.parent[p])) return false;
    if (t.type[p] === "navigation_expression") return code(t, p)[0] === x;
    if (t.type[p] === "value_argument") return token(t, p, "=") < 0 || code(t, p)[0] !== x;
    return t.type[p] !== "infix_expression" || code(t, p)[1] !== x;
};

/** Whether a binary expression is a call with type arguments tree-sitter read as comparisons: `(f < T) > (x)`. */
const genericRead = (t: Flat, x: number): boolean => {
    const left = child(t, x, "left");
    return operatorOf(t, x).startsWith(">") && left >= 0 && t.type[left] === "binary_expression" && operatorOf(t, left) === "<";
};

/**
 * Whether code in a class sees its primary constructor's parameters: their
 * defaults, the supertypes' arguments, and in the body an `init` block or a
 * property's initializer or delegate (with the lambdas and objects in them);
 * not a member function, an accessor, a nested class, an enum entry or a
 * secondary constructor, where a `val` parameter's name is the property's.
 */
const seesParams = (t: Flat, cls: number, n: number): boolean => {
    for (let y = n, below = -1; y >= 0; below = y, y = t.parent[y]) {
        const p = t.parent[y];
        if (p < 0) return false;
        if ((t.type[p] === "class_body" || t.type[p] === "enum_class_body") && t.parent[p] === cls) return t.type[y] === "anonymous_initializer" || (t.type[y] === "property_declaration" && t.type[below] !== "getter" && t.type[below] !== "setter");
        if (p === cls) return true;
    }
    return false;
};

export const kotlinProgram = (files: readonly GFile[], ctx?: ModuleContext) => {
    const kfiles = new Map<GFile, KFile>();
    const byPath = new Map<string, KFile>();
    for (const g of files) {
        // `@Suppress("INVISIBLE_MEMBER", …)`: the file may reach declarations it can't see.
        const kf: KFile = { g, t: g.flat, path: g.path, o: outlineOf(g.flat), doubt: misread(g.flat), unhides: /INVISIBLE_/.test(g.flat.text) };
        kfiles.set(g, kf);
        byPath.set(g.path, kf);
    }
    const all = [...kfiles.values()];
    const usable = all.filter((f) => !f.doubt);
    /**
     * The names each package's untrusted files may declare: files read with a
     * misread tree, Kotlin files read that tree-sitter couldn't parse, and
     * Java files read (the classes in them). A lookup of such a name in that
     * package is unknown.
     */
    const doubtWords = new Map<string, Set<string>>();
    const addDoubt = (pkg: string, text: string) => {
        const w = doubtWords.get(pkg) ?? new Set<string>();
        for (const x of declaredNames(text)) w.add(x);
        doubtWords.set(pkg, w);
    };
    /** Functions and properties whose contract may smart cast what they're called with and on, from every Kotlin file read: by the tree of a file trusted, else by its text. */
    const casters = new Set<string>();
    for (const f of all) {
        if (f.doubt) addDoubt(f.o.pkg, f.t.text);
        for (const n of (f.doubt ? null : castersOfTree(f.t)) ?? castersOfText(f.t.text)) casters.add(n);
    }
    const parsedPaths = new Set(all.map((f) => f.path));
    for (const p of ctx?.paths ?? ctx?.known ?? []) {
        const java = p.endsWith(".java");
        if ((!p.endsWith(".kt") && !java) || parsedPaths.has(p)) continue;
        const text = ctx?.text(p);
        if (text === undefined) continue;
        if (java) {
            // A Java file's classes: a name of its package that may be one is unknown.
            const { pkg, names } = javaClasses(text);
            const w = doubtWords.get(pkg) ?? new Set<string>();
            for (const x of names) w.add(x);
            doubtWords.set(pkg, w);
            continue;
        }
        addDoubt(packageOfText(text), text);
        for (const n of castersOfText(text)) casters.add(n);
    }
    /** Whether an untrusted file of a package may declare a name. */
    const doubted = (pkg: string, name: string): boolean => doubtWords.get(pkg)?.has(name) ?? false;

    // Classes by fully qualified name, and each class's file; top-level declarations by package.
    const byFqn = new Map<string, KClass[]>();
    const classOfDecl = new Map<ClassDecl, KClass>();
    const topByPkg = new Map<string, KDecl[]>();
    const fqnOf = (f: KFile, d: ClassDecl): string => {
        const parts: string[] = [];
        for (let x: ClassDecl | null = d; x; x = x.owner) parts.unshift(x.name);
        return [f.o.pkg, ...parts].filter(Boolean).join(".");
    };
    for (const f of usable) {
        for (const d of f.o.classes) {
            if (d.hidden) continue;
            const kc = { f, d, fqn: fqnOf(f, d) };
            classOfDecl.set(d, kc);
            const list = byFqn.get(kc.fqn) ?? [];
            list.push(kc);
            byFqn.set(kc.fqn, list);
        }
        for (const ds of f.o.top.values()) for (const d of ds) if (!d.hidden) (topByPkg.get(f.o.pkg) ?? topByPkg.set(f.o.pkg, []).get(f.o.pkg)!).push({ f, d });
    }

    /** The packages the files read declare: a star import of one brings what its files read declare (its other files are out of reach); of another, a library's, nothing known. */
    const repoPkgs = new Set(usable.map((f) => f.o.pkg));

    /**
     * What a file's star imports bring of a name: the declarations of read
     * files of the packages imported (those an alias import hides aside), and
     * whether a known library's package is imported too; null when one may
     * hold the name unseen: a package nothing read or known declares, a known
     * library package that has the name, a JDK package (any capitalized name).
     */
    const starInfo = (f: KFile, name: string): { decls: KDecl[]; lib: boolean } | null => {
        const decls: KDecl[] = [];
        let lib = false;
        const aliased = new Set(f.o.imports.filter((i) => !i.star && i.alias !== null).map((i) => i.path.join(".")));
        for (const i of f.o.imports) {
            if (!i.star) continue;
            const pkg = i.path.join(".");
            if (aliased.has(`${pkg}.${name}`)) continue;
            if (repoPkgs.has(pkg) || doubtWords.has(pkg)) {
                if (doubted(pkg, name)) return null;
                for (const k of topByPkg.get(pkg) ?? []) if (k.d.name === name && !unseen(f.path, k.f.path)) decls.push(k);
                continue;
            }
            if (LIB_STARS.has(pkg)) {
                if (LIB_NAMES.has(name)) return null;
                lib = true;
                continue;
            }
            if (/^javax?\./.test(pkg)) {
                if (/^[A-Z]/.test(name)) return null;
                lib = true;
                continue;
            }
            // `import a.B.*`: a class read's nested classes.
            const cls = classesNamed(f, pkg);
            if (cls.length === 1) {
                for (const d of cls[0].d.members.get(name) ?? []) if (isClass(d)) decls.push({ f: cls[0].f, d });
                continue;
            }
            return null;
        }
        return { decls, lib };
    };

    /** A declaration's unit: its card. */
    const unitOf = (k: KDecl): Unit | undefined => k.f.g.unitByNode.get(k.d.node);
    /** A constructor's unit, or its class's for a primary one. */
    const ctorUnit = (k: KDecl, cls: KClass): Unit | undefined => (k.d.node === cls.d.node || k.f.t.type[k.d.node] === "primary_constructor" ? unitOf(cls) : unitOf(k));

    /** Whether a declaration may be a link's target: not expect or actual, nor in or on one. */
    /**
     * Whether a declaration may be a link's target from a file: one not
     * `expect` or `actual` (nor in one), an `expect` one from common code
     * (where calls name it, no `actual` being seen), an `actual` one from its
     * own source set or a test of it (where calls name it rather than the
     * `expect`). A constructor goes by its class.
     */
    const linkable = (from: KFile, k: { f: KFile; d: Decl }): boolean => {
        let d: Decl | null = k.d;
        if (d.kind === "ctor") d = ctorClass(k as KDecl)?.d ?? null;
        if (!d) return false;
        let mpp: "expect" | "actual" | null = null;
        for (let x: Decl | null = d; x; x = x.owner) {
            if (x.mods.has("expect")) mpp = "expect";
            else if (x.mods.has("actual") && mpp === null) mpp = "actual";
        }
        if (!mpp) return true;
        const a = rootOf(from.path);
        const b = rootOf(k.f.path);
        if (!a || !b) return false;
        if (mpp === "expect") return commonSet(a.set) && commonSet(b.set);
        return a.dir === b.dir || (a.module === b.module && /Test$/.test(a.set) && b.set === a.set.replace(/Test$/, "Main"));
    };

    /**
     * Whether code at a place may use a declaration, by its visibility: a
     * private member inside its class (its nested classes; a companion's in
     * the class around it), a private top-level one in its file; a protected
     * member through `this` in a subclass; an internal one in its module
     * ("unknown" in another: a friend module may see it).
     */
    const access = (at: At, k: KDecl, owner: ClassDecl | null = k.d.owner): "yes" | "no" | "unknown" => {
        const a = accessNow(at, k, owner);
        return a === "no" && at.f.unhides ? "unknown" : a;
    };
    const accessNow = (at: At, k: KDecl, owner: ClassDecl | null): "yes" | "no" | "unknown" => {
        const m = k.d.mods;
        if (m.has("private")) {
            if (!owner) return k.f === at.f ? "yes" : "no";
            if (k.f !== at.f) return "no";
            if (within(at.f.t, at.n, owner.node)) return "yes";
            if (owner.kind === "companion" && owner.owner && within(at.f.t, at.n, owner.owner.node)) return "yes";
            return "no";
        }
        if (m.has("protected")) {
            if (!owner) return "unknown";
            // A companion's protected member is its class's: seen in that class's subclasses.
            const holder = owner.kind === "companion" && owner.owner ? owner.owner : owner;
            if (k.f === at.f && within(at.f.t, at.n, holder.node)) return "yes";
            if (!at.viaThis) return "unknown";
            const oc = classOfDecl.get(holder);
            for (let x = at.f.t.parent[at.n]; x >= 0; x = at.f.t.parent[x]) {
                if (!CLASS_LIKE.has(at.f.t.type[x])) continue;
                const c = classAt(at.f, x);
                const a = c ? ancestry(c) : null;
                if (!a || !oc) return "unknown";
                if (a.includes(oc)) return "yes";
            }
            return "no";
        }
        if (m.has("internal")) {
            const a = rootOf(at.f.path);
            const b = rootOf(k.f.path);
            return a && b && a.module === b.module ? "yes" : "unknown";
        }
        return "yes";
    };

    /** Declarations a place may use, and those whose visibility there is unknown. */
    const split = (at: At, ks: KDecl[]): { ok: KDecl[]; hidden: KDecl[] } => {
        const ok: KDecl[] = [];
        const hidden: KDecl[] = [];
        for (const k of ks) {
            const a = access(at, k, k.d.kind === "ctor" ? (ctorClass(k)?.d ?? null) : k.d.owner);
            if (a === "yes") ok.push(k);
            else if (a === "unknown") hidden.push(k);
        }
        return { ok, hidden };
    };

    /** Declarations a place may use; null when one's visibility there is unknown. */
    const usableBy = (at: At, ks: KDecl[]): KDecl[] | null => {
        const out: KDecl[] = [];
        for (const k of ks) {
            const a = access(at, k, k.d.kind === "ctor" ? (ctorClass(k)?.d ?? null) : k.d.owner);
            if (a === "unknown") return null;
            if (a === "yes") out.push(k);
        }
        return out;
    };

    // ---- Classifiers -------------------------------------------------------------------------

    /** The classes read with a fully qualified name, that a file sees. */
    const classesNamed = (from: KFile, fqn: string): KClass[] => (byFqn.get(fqn) ?? []).filter((c) => !unseen(from.path, c.f.path));

    /** The type parameters declared by the declarations around a node. */
    const typeParamsAround = (f: KFile, n: number): Set<string> => {
        const out = new Set<string>();
        for (let x = f.t.parent[n]; x >= 0; x = f.t.parent[x]) {
            const tp = kid(f.t, x, "type_parameters");
            if (tp >= 0) for (const p of code(f.t, tp)) if (f.t.type[p] === "type_parameter") out.add(nameOf(f.t, kid(f.t, p, "identifier")));
        }
        return out;
    };

    /** Local classes and type aliases declared in the blocks around a node. */
    const localClassifiers = (f: KFile, n: number, name: string): boolean => {
        for (let x = f.t.parent[n]; x >= 0; x = f.t.parent[x]) {
            if (f.t.type[x] !== "block" && f.t.type[x] !== "lambda_literal" && f.t.type[x] !== "function_body") continue;
            for (const c of code(f.t, x)) {
                const ty = f.t.type[c];
                if ((ty === "class_declaration" || ty === "object_declaration") && nameOf(f.t, kid(f.t, c, "identifier")) === name) return true;
                if (ty === "type_alias" && code(f.t, c).some((i) => f.t.field[i] === "type" && nameOf(f.t, i) === name)) return true;
            }
        }
        return false;
    };

    /** The class read that a class declaration node is. */
    const classAt = (f: KFile, node: number): KClass | undefined => {
        const d = f.o.byNode.get(node);
        return d && isClass(d) ? classOfDecl.get(d) : undefined;
    };

    /**
     * A class's supertypes, resolved where its header writes them: a class
     * read, `"any"` for `Any`, or null for one the reads can't name (a library
     * type, a class not read): then its members aren't known.
     */
    const superMemo = new Map<KClass, (KClass | "any" | { lib: string } | null)[]>();
    const supersOf = (c: KClass): (KClass | "any" | { lib: string } | null)[] => {
        const hit = superMemo.get(c);
        if (hit) return hit;
        superMemo.set(c, [null]);
        const out: (KClass | "any" | { lib: string } | null)[] = [];
        for (const s of c.d.supers) {
            const r = resolveType(c.f, s.type);
            if (s.by) out.push(null);
            else if (r?.k === "class") out.push(r.c);
            else if (r?.k === "std" && r.name === "Any") out.push("any");
            else if (r && (r.k === "std" || r.k === "lib") && LIB_MEMBERS.has(r.name)) out.push({ lib: r.name });
            else out.push(null);
        }
        superMemo.set(c, out);
        return out;
    };

    /** Every class a class is, itself first, or null when one of them isn't known. */
    const ancestryMemo = new Map<KClass, KClass[] | null>();
    const libMemo = new Map<KClass, Set<string>>();
    /** The library types a class is, by name (`java.io.Serializable`): what a library's extension may take. */
    const libTypeMemo = new Map<KClass, Set<string>>();
    const ancestry = (c: KClass): KClass[] | null => {
        if (ancestryMemo.has(c)) return ancestryMemo.get(c)!;
        ancestryMemo.set(c, null);
        const out: KClass[] = [c];
        const lib = new Set<string>();
        const types = new Set<string>();
        // An enum's implicit supertype is Enum, an annotation's Annotation: their members are listed apart.
        for (const s of supersOf(c)) {
            if (s === "any") continue;
            if (!s) return null;
            if ("lib" in s) {
                for (const n of LIB_MEMBERS.get(s.lib)!.split(" ")) if (n) lib.add(n);
                types.add(s.lib);
                continue;
            }
            const up = ancestry(s);
            if (!up) return null;
            for (const x of up) if (!out.includes(x)) out.push(x);
            for (const n of libMemo.get(s) ?? []) lib.add(n);
            for (const n of libTypeMemo.get(s) ?? []) types.add(n);
        }
        ancestryMemo.set(c, out);
        libMemo.set(c, lib);
        libTypeMemo.set(c, types);
        return out;
    };

    /**
     * The annotations on a class and its supertypes that may be DSL markers
     * (`@DslMarker annotation class KtorDsl`): those declared so in a file
     * read, and those no file read declares (unknown). Two implicit receivers
     * marked alike hide the outer one's members from code inside the inner one.
     */
    const dslMarkers = new Set<string>();
    const annotationClasses = new Set<string>();
    for (const f of usable) for (const c of f.o.classes) if (c.kind === "annotation") {
        annotationClasses.add(c.name);
        if (c.annotations.includes("DslMarker")) dslMarkers.add(c.name);
    }
    const markersOf = (c: KClass): Set<string> => {
        const out = new Set<string>();
        for (const x of ancestry(c) ?? [c]) for (const a of x.d.annotations) if (dslMarkers.has(a) || !annotationClasses.has(a)) out.add(a);
        return out;
    };

    /**
     * The classes whose static scope (companion, nested classes) code in a
     * class sees: the class, then its superclasses; an interface's are seen
     * only inside it, not in what implements or extends it. Null when a
     * supertype isn't known.
     */
    const staticChain = (c: KClass): KClass[] | null => {
        if (!ancestry(c)) return null;
        const out: KClass[] = [c];
        for (let x = c; ; ) {
            const up = supersOf(x).find((s): s is KClass => !!s && s !== "any" && !("lib" in s) && s.d.kind === "class");
            if (!up || out.includes(up)) break;
            out.push(up);
            x = up;
        }
        return out;
    };

    /** The member names a class has from library supertypes of known members. */
    const libNames = (c: KClass): Set<string> => (ancestry(c) ? (libMemo.get(c) ?? new Set()) : new Set());
    /** Whether a class has a library supertype (`java.io.Serializable`, `java.util.EventListener`, whose members are none). */
    const libTypes = (c: KClass): boolean => (ancestry(c) ? (libTypeMemo.get(c)?.size ?? 0) > 0 : false);

    const isSubclass = (c: KClass, of: KClass): boolean | null => {
        const a = ancestry(c);
        if (a) return a.includes(of);
        return c === of ? true : null;
    };

    /** The classifiers named `name` a class declares inside it, or that its superclasses declare (Kotlin's static scope); null when a supertype isn't known. */
    const nestedNamed = (c: KClass, name: string, inherited: boolean, at: At | null): KClass[] | null => {
        const visible = (xs: KClass[]): KClass[] | null => {
            if (!at) return xs;
            const u = usableBy(at, xs.map((x) => ({ f: x.f, d: x.d })));
            return u === null ? null : xs.filter((x) => u.some((k) => k.d === x.d));
        };
        const own = visible((c.d.members.get(name) ?? []).filter(isClass).map((d) => classOfDecl.get(d as ClassDecl)!));
        if (own === null || c.d.members.get(name)?.some((d) => d.kind === "alias")) return null;
        if (!inherited || own.length > 0) return own;
        const a = staticChain(c);
        if (!a) return null;
        const found: KClass[] = [];
        for (const x of a.slice(1)) for (const d of x.d.members.get(name) ?? []) if (isClass(d) && !d.mods.has("private")) found.push(classOfDecl.get(d)!);
        if (a.slice(1).some((x) => x.d.members.get(name)?.some((d) => d.kind === "alias"))) return null;
        return visible(found);
    };

    /**
     * The class a simple type name at a node names: type parameters, local
     * classes, each enclosing class's own and inherited nested classes, then
     * the file's explicit imports, its package, its star imports. Null when
     * none is proven: a name of the default imports, a class not read, two.
     */
    const lookupClassifier = (f: KFile, n: number, name: string): KClass | null => {
        if (typeParamsAround(f, n).has(name) || localClassifiers(f, n, name)) return null;
        for (let x = f.t.parent[n]; x >= 0; x = f.t.parent[x]) {
            if (!CLASS_LIKE.has(f.t.type[x])) continue;
            // A class's supertypes, annotations and type parameters don't see what it nests.
            if (placeIn(f.t, x, n) === "header") continue;
            const c = classAt(f, x);
            if (!c) {
                // An object literal or an enum entry's body: its supertypes' nested classes are in scope, unknown here.
                if (f.t.type[x] === "object_literal" || f.t.type[x] === "enum_entry") return null;
                continue;
            }
            const found = staticNested(c, name, { f, n, viaThis: true });
            if (!found) return null;
            if (found.length === 1) return found[0];
            if (found.length > 1) return null;
        }
        return fileClassifier(f, name);
    };

    /**
     * The classifiers named so a class's code sees in its static scope, in
     * Kotlin's order: the class's own nested ones, its companion's, then its
     * superclasses' (not their companions'); null when one isn't known.
     */
    const staticNested = (c: KClass, name: string, at: At | null): KClass[] | null => {
        const own = nestedNamed(c, name, false, at);
        if (own === null || own.length > 0) return own;
        if (c.d.companion) {
            const cc = classOfDecl.get(c.d.companion);
            const inComp = cc ? nestedNamed(cc, name, false, at) : null;
            if (inComp === null || inComp.length > 0) return inComp;
        }
        return nestedNamed(c, name, true, at);
    };

    /** A simple type name at the file's level: explicit imports, the package, star imports. */
    const fileClassifier = (f: KFile, name: string): KClass | null => {
        const explicit = importsOf(f, name);
        if (explicit.length > 0) {
            if (explicit.length > 1 || doubted(explicit[0].path.slice(0, -1).join("."), explicit[0].path[explicit[0].path.length - 1])) return null;
            const found = importedClasses(f, explicit[0].path);
            return found.length === 1 && access({ f, n: 0, viaThis: false }, { f: found[0].f, d: found[0].d }) === "yes" ? found[0] : null;
        }
        if (doubted(f.o.pkg, name)) return null;
        const pkgAll = (byFqn.get(f.o.pkg ? `${f.o.pkg}.${name}` : name) ?? []).filter((c) => !c.d.owner && !unseen(f.path, c.f.path));
        const pkgOk = usableBy({ f, n: 0, viaThis: false }, pkgAll.map((c) => ({ f: c.f, d: c.d })));
        if (pkgOk === null) return null;
        const pkg = pkgAll.filter((c) => pkgOk.some((k) => k.d === c.d));
        if (pkg.length > 0) return pkg.length === 1 ? pkg[0] : null;
        // A type alias of the package by that name: no class.
        if ((topByPkg.get(f.o.pkg) ?? []).some((k) => k.d.name === name && k.d.kind === "alias" && !unseen(f.path, k.f.path))) return null;
        const stars = f.o.imports.filter((i) => i.star);
        const hidden = new Set(f.o.imports.filter((i) => !i.star && i.alias !== null).map((i) => i.path.join(".")));
        const found: KClass[] = [];
        for (const s of stars) {
            const fqn = [...s.path, name].join(".");
            if (hidden.has(fqn)) continue;
            if (doubted(s.path.join("."), name)) return null;
            found.push(...importedClasses(f, [...s.path, name]));
        }
        return found.length === 1 && access({ f, n: 0, viaThis: false }, { f: found[0].f, d: found[0].d }) === "yes" ? found[0] : null;
    };

    /** The classes read a qualified name names: a top-level class, or a nested one through its outer classes. */
    const importedClasses = (f: KFile, path: readonly string[]): KClass[] => classesNamed(f, path.join(".")).filter((c) => {
        // `a.b.C` is a class of package a.b, or class b.C of package a, ...: its package and outer names must match the file's.
        const own = [c.f.o.pkg, ...outerNames(c.d)].filter(Boolean).join(".");
        return own === path.join(".");
    });

    const outerNames = (d: ClassDecl): string[] => {
        const parts: string[] = [];
        for (let x: ClassDecl | null = d; x; x = x.owner) parts.unshift(x.name);
        return parts;
    };

    /** What a type node names: a class read, a type of the default imports (by name), a type parameter; null when unknown. */
    const typeMemo = new Map<string, Ty | null>();
    const resolveType = (f: KFile, typeNode: number): Ty | null => {
        if (typeNode < 0) return null;
        const key = `${f.path}#${typeNode}`;
        if (typeMemo.has(key)) return typeMemo.get(key)!;
        typeMemo.set(key, null);
        const now = resolveTypeNow(f, typeNode);
        const pc = now?.k === "class" ? platformClass(f, now.c) : null;
        const r = now?.k === "class" ? (pc ? { ...now, c: pc } : null) : now;
        typeMemo.set(key, r);
        return r;
    };

    /**
     * The class code in a file means by a class read: from common code, the
     * class itself; from a platform's code, an `expect` class (or one inside
     * one) is its `actual` there, when exactly one is read and seen there,
     * else unknown: the actual's members aren't the expect's.
     */
    const platformClass = (f: KFile, c: KClass): KClass | null => {
        if (mppOf({ f: c.f, d: c.d }) !== "expect") return c;
        const r = rootOf(f.path);
        if (r && commonSet(r.set)) return c;
        const actuals = (byFqn.get(c.fqn) ?? []).filter((x) => x !== c && mppOf({ f: x.f, d: x.d }) === "actual" && linkable(f, x));
        return actuals.length === 1 ? actuals[0] : null;
    };
    const resolveTypeNow = (f: KFile, typeNode: number): Ty | null => {
        const t = f.t;
        const isNull = nullable(t, typeNode);
        const x = stripType(t, typeNode);
        if (x < 0 || t.type[x] !== "user_type") return null;
        const parts = typeParts(t, x);
        if (parts.length === 0) return null;
        const first = nameOf(t, parts[0].name);
        if (parts.length === 1) {
            if (typeParamsAround(f, x).has(first)) return { k: "param", nullable: isNull };
            const c = lookupClassifier(f, parts[0].name, first);
            if (c) return { k: "class", c, nullable: isNull };
            // A library type an import names, whose members are known.
            const imp = importsOf(f, first);
            if (imp.length === 1 && LIB_MEMBERS.has(imp[0].path.join(".")) && importedClasses(f, imp[0].path).length === 0 && !enclosingNested(f, parts[0].name, first) && !typeParamsAround(f, parts[0].name).has(first)) return { k: "lib", name: imp[0].path.join("."), nullable: isNull };
            // A name of the default imports that nothing read declares.
            if (STD_CLASSES.has(first) && !shadowedStd(f, parts[0].name, first)) return { k: "std", name: first, nullable: isNull };
            return null;
        }
        const c = qualifiedClass(f, parts.map((p) => p.name));
        return c ? { k: "class", c, nullable: isNull } : null;
    };

    /** Whether a default-import type name might be something else where it's written: a class read, an import, a star import, a type parameter. */
    const shadowedStd = (f: KFile, n: number, name: string): boolean =>
        typeParamsAround(f, n).has(name) || localClassifiers(f, n, name) || importsOf(f, name).length > 0 || starInfo(f, name)?.decls.length !== 0 || (topByPkg.get(f.o.pkg) ?? []).some((k) => k.d.name === name) || enclosingNested(f, n, name);

    /** Whether a class around a node declares or may inherit a nested classifier named so. */
    const enclosingNested = (f: KFile, n: number, name: string): boolean => {
        for (let x = f.t.parent[n]; x >= 0; x = f.t.parent[x]) {
            if (!CLASS_LIKE.has(f.t.type[x]) || placeIn(f.t, x, n) === "header") continue;
            const c = classAt(f, x);
            if (!c) return true;
            const found = staticNested(c, name, null);
            if (!found || found.length > 0) return true;
        }
        return false;
    };

    /** The class a written qualified type names (`Outer.Inner`, `a.b.Foo`), or null. */
    const qualifiedClass = (f: KFile, names: readonly number[]): KClass | null => {
        const t = f.t;
        const first = nameOf(t, names[0]);
        let c: KClass | null = null;
        let i = 1;
        if (typeParamsAround(f, names[0]).has(first)) return null;
        const head = lookupClassifier(f, names[0], first);
        if (head) c = head;
        else {
            // A package path: the longest prefix that names a class read.
            if (classLikeNameInScope(f, names[0], first)) return null;
            const segs = names.map((x) => nameOf(t, x));
            for (i = 1; i <= segs.length; i++) {
                const found = classesNamed(f, segs.slice(0, i).join(".")).filter((k) => !k.d.owner && k.f.o.pkg === segs.slice(0, i - 1).join("."));
                if (found.length === 1) {
                    c = found[0];
                    break;
                }
            }
            if (!c) return null;
        }
        for (; i < names.length; i++) {
            const nested = nestedNamed(c!, nameOf(t, names[i]), false, { f, n: names[i], viaThis: false });
            if (!nested || nested.length !== 1) return null;
            c = nested[0];
        }
        return c;
    };

    /** Whether a name may be a class or a value where it's written, so not a package's first segment. */
    const classLikeNameInScope = (f: KFile, n: number, name: string): boolean => /^[A-Z]/.test(name) || importsOf(f, name).length > 0 || localNames(f, n).has(name);

    // ---- Locals and receivers ----------------------------------------------------------------

    /** The names declared in the code around a node (parameters, locals, local functions and classes), from every function and lambda around it. */
    const localNames = (f: KFile, n: number): Set<string> => {
        const t = f.t;
        const out = new Set<string>();
        const addDecl = (v: number) => {
            if (t.type[v] === "variable_declaration") {
                const id = kid(t, v, "identifier");
                if (id >= 0) out.add(nameOf(t, id));
            } else if (t.type[v] === "multi_variable_declaration") for (const c of code(t, v)) addDecl(c);
        };
        for (let x = t.parent[n]; x >= 0; x = t.parent[x]) {
            const ty = t.type[x];
            if (ty === "source_file") break;
            if (ty === "block" || ty === "lambda_literal" || ty === "function_body" || ty === "anonymous_initializer") {
                for (const c of code(t, x)) {
                    const ct = t.type[c];
                    if (ct === "property_declaration") for (const v of code(t, c)) addDecl(v);
                    else if (ct === "function_declaration" || ct === "class_declaration" || ct === "object_declaration") {
                        const id = code(t, c).find((i) => t.type[i] === "identifier");
                        if (id !== undefined) out.add(nameOf(t, id));
                    }
                }
            }
            if (ty === "lambda_literal") {
                const lp = kid(t, x, "lambda_parameters");
                if (lp >= 0) for (const v of code(t, lp)) addDecl(v);
                else out.add("it");
            }
            if (ty === "function_declaration" || ty === "anonymous_function" || ty === "secondary_constructor") for (const p of paramsOf(t, kid(t, x, "function_value_parameters"))) out.add(p.name);
            if (ty === "setter") {
                const id = code(t, x).find((i) => t.type[i] === "identifier");
                if (id !== undefined) out.add(nameOf(t, id));
                else out.add("value");
            }
            // An accessor's backing field.
            if (ty === "getter" || ty === "setter") out.add("field");
            if (ty === "for_statement") for (const v of code(t, x)) addDecl(v);
            if (ty === "catch_block") {
                const id = kid(t, x, "identifier");
                if (id >= 0) out.add(nameOf(t, id));
            }
            if (ty === "when_expression") {
                const subj = kid(t, x, "when_subject");
                const v = subj >= 0 ? kid(t, subj, "variable_declaration") : -1;
                if (v >= 0) addDecl(v);
            }
            if (ty === "class_declaration" && seesParams(t, x, n)) {
                const pc = kid(t, x, "primary_constructor");
                const list = pc >= 0 ? kid(t, pc, "class_parameters") : -1;
                if (list >= 0) for (const p of code(t, list)) if (t.type[p] === "class_parameter") out.add(nameOf(t, kid(t, p, "identifier")));
            }
        }
        return out;
    };

    /** A receiver of the code at a node: its type, or "unknown" when nobody wrote it down. */
    type Frame = { kind: "lambda" | "ext" | "class" | "companion"; ty: Ty | "unknown"; node: number };

    /**
     * The implicit receivers of the code at a node, innermost first: lambdas
     * with a receiver, extensions' receivers, each class around (its
     * companion and its supertypes' after it), an inner class's outer class,
     * a nested class's outer classes' companions only.
     */
    const frameMemo = new Map<string, Frame[]>();
    const framesAt = (f: KFile, n: number): Frame[] => {
        const key = `${f.path}#${n}`;
        const hit = frameMemo.get(key);
        if (hit) return hit;
        const t = f.t;
        const out: Frame[] = [];
        let instance = true;
        let skip: KClass | null = null;
        // A secondary constructor's parameters and delegation call (`constructor(x: Int = f()) : this(g())`) run before the class has an instance.
        let beforeInstance = false;
        for (let x = t.parent[n]; x >= 0; x = t.parent[x]) {
            const ty = t.type[x];
            if (ty === "secondary_constructor") {
                const body = kid(t, x, "block");
                if (!(body >= 0 && within(t, n, body))) beforeInstance = true;
                continue;
            }
            if (ty === "lambda_literal") {
                const r = lambdaReceiver(f, x);
                if (r !== "none") out.push({ kind: "lambda", ty: r, node: x });
            } else if (ty === "function_declaration" || (ty === "property_declaration" && !inBody(t, x))) {
                const d = f.o.byNode.get(x);
                const recv = d ? d.receiver : -1;
                if (recv >= 0) out.push({ kind: "ext", ty: resolveType(f, recv) ?? "unknown", node: x });
                else if (!d && ty === "function_declaration") {
                    // A local function: its receiver, if it writes one, from its header.
                    const name = code(t, x).find((c) => t.field[c] === "name") ?? -1;
                    let r = -1;
                    for (let c = t.first[x]; c >= 0 && c !== name; c = t.next[c]) if (t.type[c] === "user_type" || t.type[c] === "nullable_type") r = c;
                    if (r >= 0) out.push({ kind: "ext", ty: resolveType(f, r) ?? "unknown", node: x });
                }
            } else if (ty === "anonymous_function") {
                // `fun T.() {}`: a receiver written before the parameters.
                let r = -1;
                for (let c = t.first[x]; c >= 0 && t.type[c] !== "function_value_parameters"; c = t.next[c]) if (t.type[c] === "user_type" || t.type[c] === "nullable_type") r = c;
                if (r >= 0) out.push({ kind: "ext", ty: resolveType(f, r) ?? "unknown", node: x });
            } else if (CLASS_LIKE.has(ty)) {
                if (ty === "enum_entry") {
                    // An entry's arguments run before the enum has an instance; its body is a class of its own no unit stands for.
                    const body = kid(t, x, "class_body");
                    if (body >= 0 && within(t, n, body)) out.push({ kind: "class", ty: "unknown", node: x });
                    instance = false;
                    continue;
                }
                const place = beforeInstance ? "ctor" : placeIn(t, x, n);
                beforeInstance = false;
                const c = classAt(f, x);
                if (!c) {
                    // An object literal: a receiver of a class no unit stands for; its supertypes' arguments see their companions.
                    if (place !== "header") out.push({ kind: "class", ty: "unknown", node: x });
                    continue;
                }
                if (place === "body") {
                    if (instance) out.push({ kind: "class", ty: { k: "class", c, nullable: false }, node: x });
                    // An object's own `this`, then the classes around see only their companions.
                    else if (c.d.kind === "companion" || c.d.kind === "object") out.push({ kind: "class", ty: { k: "class", c, nullable: false }, node: x });
                }
                // The body and the constructor part see the class's companion and its superclasses' companions (its static scope); the header sees neither. A companion's own constructor part doesn't see the companion.
                if (place !== "header") {
                    const a = staticChain(c);
                    if (!a) out.push({ kind: "companion", ty: "unknown", node: x });
                    else for (const k of a) if (k.d.companion && classOfDecl.get(k.d.companion) !== skip) out.push({ kind: "companion", ty: { k: "class", c: classOfDecl.get(k.d.companion)!, nullable: false }, node: x });
                }
                if (c.d.kind === "companion" && place === "ctor") skip = c;
                // Past a class that isn't inner, the classes around are reached only through their companions; its constructor part has no instance of it either.
                instance = instance && c.d.mods.has("inner");
            }
        }
        frameMemo.set(key, out);
        return out;
    };

    /** Whether a node is inside a function's or a lambda's body (a local declaration). */
    const inBody = (t: Flat, n: number): boolean => {
        for (let x = t.parent[n]; x >= 0; x = t.parent[x]) {
            if (FUNCTIONS.has(t.type[x])) return true;
            if (CLASS_LIKE.has(t.type[x]) || t.type[x] === "source_file") return false;
        }
        return false;
    };

    /**
     * A lambda's receiver: "none", its type, or "unknown". Known from the
     * parameter it's passed to: a function read (its parameter's function
     * type), or a function of the standard library proven to be the one
     * called (`let` takes none, `apply` its receiver's, `with` its argument's).
     */
    const lambdaMemo = new Map<string, Ty | "none" | "unknown">();
    const lambdaReceiver = (f: KFile, lam: number): Ty | "none" | "unknown" => {
        const key = `${f.path}#${lam}`;
        if (lambdaMemo.has(key)) return lambdaMemo.get(key)!;
        lambdaMemo.set(key, "unknown");
        const r = lambdaReceiverNow(f, lam);
        lambdaMemo.set(key, r);
        return r;
    };
    const lambdaReceiverNow = (f: KFile, lam: number): Ty | "none" | "unknown" => {
        const t = f.t;
        let holder = t.parent[lam];
        if (t.type[holder] === "annotated_lambda") holder = t.parent[holder];
        else if (t.type[holder] === "labeled_expression") holder = t.parent[holder];
        let call: Call | null = null;
        let position = -1;
        if (t.type[holder] === "call_expression") {
            call = callOf(t, holder);
            // The head of `f(a) {}` is nested: the lambda belongs to the outer call.
            if (call && call.lambda < 0) return "unknown";
        } else if (t.type[holder] === "value_argument") {
            const vargs = t.parent[holder];
            const c = t.parent[vargs];
            const outer = t.type[c] === "call_expression" ? callAround(t, code(t, c)[0]) : -1;
            call = callOf(t, outer >= 0 ? outer : c);
            if (!call || argOf(t, holder).name !== null) return "unknown";
            position = call.args.indexOf(holder);
        } else return "unknown";
        if (!call) return "unknown";
        const target = calleeOf(f, call);
        if (target === "unknown") return "unknown";
        if (target.kind === "std") {
            const k = STD_LAMBDAS.get(target.name);
            if (k === "P") return "none";
            // `apply`, `run`: the receiver's type; called bare, the innermost implicit receiver's, which changes nothing.
            if (k === "S") {
                if (target.receiver < 0) return framesAt(f, call.node).length === 0 ? "none" : ((): Ty | "unknown" => {
                    const fr = framesAt(f, call!.node)[0];
                    return fr.ty;
                })();
                const rt = typeOf(f, target.receiver);
                if (!rt) return "unknown";
                return navOf(t, call.callee)?.op === "?." ? { ...rt, nullable: false } : rt;
            }
            if (k === "W" && call.args.length === 1 && call.lambda >= 0) {
                const a = argOf(t, call.args[0]);
                return a.name === null ? (typeOf(f, a.value) ?? "unknown") : "unknown";
            }
            return "unknown";
        }
        // A function read: the parameter the lambda fills.
        const params = target.decl.d.params;
        const p = position >= 0 ? params[position] : params[params.length - 1];
        if (!p || (position >= 0 && params.slice(0, position + 1).some((x) => x.vararg))) return "unknown";
        const ft = stripType(target.decl.f.t, p.type);
        if (ft < 0 || target.decl.f.t.type[ft] !== "function_type") return "unknown";
        // `R.(A) -> B`: a user type before the parameters.
        const ftt = target.decl.f.t;
        const first = code(ftt, ft)[0];
        if (first !== undefined && ftt.type[first] !== "function_type_parameters" && ftt.type[first] !== "type_modifiers") {
            const rt = resolveType(target.decl.f, first);
            if (!rt || rt.k === "param") return "unknown";
            return rt;
        }
        return "none";
    };

    /** What a call's callee is, for its lambda's receiver: a function read, a standard library function proven to be the one, or unknown. */
    type Callee = { kind: "decl"; decl: KDecl } | { kind: "std"; name: string; receiver: number };
    const calleeOf = (f: KFile, call: Call): Callee | "unknown" => {
        const t = f.t;
        const c = call.callee;
        if (t.type[c] === "identifier") {
            const name = nameOf(t, c);
            const d = resolveBareCall(f, c, name, call);
            if (d) return { kind: "decl", decl: d.decl };
            return stdBare(f, c, name) ? { kind: "std", name, receiver: -1 } : "unknown";
        }
        const nav = navOf(t, c);
        if (!nav || nav.op === "::") return "unknown";
        const name = nameOf(t, nav.name);
        const d = resolveMemberCall(f, nav.receiver, nav.op, name, call);
        if (d) return { kind: "decl", decl: d.decl };
        return stdMember(f, nav.receiver, name) ? { kind: "std", name, receiver: nav.receiver } : "unknown";
    };

    /** Whether a bare name surely is the default imports' (no local, receiver, import, package or star import may hold it). */
    const stdBare = (f: KFile, n: number, name: string): boolean => {
        if (!STD_TOP.has(name) && !STD_ANY_EXT.has(name)) return false;
        if (localNames(f, n).has(name)) return false;
        if (framesAt(f, n).length > 0 && mayCast(f, n, "this")) return false;
        for (const fr of framesAt(f, n)) {
            if (fr.ty === "unknown") return false;
            if (fr.ty.k !== "class") {
                if (fr.ty.k === "param") return false;
                continue;
            }
            const m = membersNamed(fr.ty.c, name);
            if (m === null || m.length > 0) return false;
        }
        return noFileDeclaration(f, name);
    };

    /**
     * Whether a bare call surely calls what has no contract. Locals come
     * first (`localCall`); then a known library's function (`libBare`); a
     * Java method imported by name (from `java.`, `javax.`, JUnit, AssertJ,
     * Guava or Hamcrest, which Kotlin contracts can't be written in) when no
     * receiver around may answer before it; a function read that may apply
     * when every source of the name is read and none has a contract; or a
     * constructor (a class's, read or the standard library's or the JDK's,
     * when no function of the name may answer).
     */
    const contractFree = (f: KFile, n: number, name: string, args: Args): boolean => {
        const local = localCall(f, n, name, args);
        if (local === null || casters.has(name) || LIB_CASTERS.has(name)) return false;
        if (local === "sure" || libBare(f, n, name)) return true;
        const explicit = importsOf(f, name);
        if (explicit.length > 0 && explicit.every((i) => JAVA_ONLY.test(i.path.join(".")) || CONTRACT_FREE.test(i.path.join("."))) && receiversFree(f, n, name)) return true;
        // A function of the name read (or a local) that may apply, every source of the name read (receivers around, imports, the package, star imports), none with a contract and no value of the name to invoke instead: the call is one of them, or the standard library's.
        if ((local === "maybe" || declaredRead(f, n, name, explicit, args)) && sourcesRead(f, n, name, explicit) && valuesFree(f, n, name, explicit)) return true;
        if (!/^[A-Z]/.test(name)) return false;
        // A constructor: no function of the name around, in the package, the imports or the default imports.
        for (const fr of framesAt(f, n)) {
            if (fr.ty === "unknown" || fr.ty.k !== "class") return false;
            const m = membersNamed(fr.ty.c, name);
            if (m === null || m.some((x) => !isClass(x.d))) return false;
        }
        if (STD_TOP.has(name) || doubted(f.o.pkg, name)) return false;
        if ((topByPkg.get(f.o.pkg) ?? []).some((k) => k.d.name === name && !isClass(k.d) && !unseen(f.path, k.f.path))) return false;
        if (explicit.some((i) => importTargets(f, i.path)?.some((k) => !isClass(k.d)) ?? !/^javax?\./.test(i.path.join(".")))) return false;
        const c = lookupClassifier(f, n, name);
        // A class of the package or an import comes before the star imports, which can't hold another candidate then.
        // A class read: a constructor of it that may apply, and no companion `invoke`.
        const ctor = (x: KClass) => !companionInvokes(x, { f, n, viaThis: false }) && (ctorCands(x) ?? []).some((k) => verdictOf(f, args, k) !== "no");
        if (c && (c.d.owner || c.f.o.pkg === f.o.pkg || explicit.length > 0)) return ctor(c);
        const star = starInfo(f, name);
        if (!star || star.decls.some((k) => !isClass(k.d))) return false;
        if (c) return ctor(c);
        // A class of the default imports or one a Java import names.
        return (STD_CLASSES.has(name) && !shadowedStd(f, n, name)) || explicit.some((i) => /^javax?\./.test(i.path.join(".")));
    };

    /**
     * How surely a bare call calls a local: a local function (which can't
     * have a contract) or a value of a function type (its own `invoke`) that
     * may apply, the innermost scope first; "no" for none; null when a local
     * value of another type may be invoked (its `invoke` may have a contract).
     * Only declarations before the call count, as Kotlin sees them.
     */
    const localCall = (f: KFile, n: number, name: string, args: Args): Verdict | null => {
        const t = f.t;
        let best: Verdict = "no";
        const fnType = (type: number): number => {
            const x = type >= 0 ? stripType(t, type) : -1;
            return x >= 0 && t.type[x] === "function_type" ? x : -1;
        };
        // A value: a function type's `invoke` judged by its parameters' types (a named argument fits none), or null.
        const value = (type: number): Verdict | null => {
            const ft = fnType(type);
            if (ft < 0) return null;
            const ps = code(t, kid(t, ft, "function_type_parameters")).map((p) => ({ name: "", node: p, type: t.type[p] === "parameter" ? (code(t, p).find((y) => TYPE_NODES.has(t.type[y])) ?? -1) : p, def: false, vararg: false }));
            return args.named.size > 0 || args.typeArgs >= 0 ? "no" : paramsFit(f, args, f, ps, false);
        };
        // A local class or object sees the locals around it too (after its own members, which aren't locals).
        for (let x = t.parent[n], below = n; x >= 0; below = x, x = t.parent[x]) {
            const ty = t.type[x];
            if (ty === "source_file") break;
            const vs: (Verdict | null)[] = [];
            if (ty === "block" || ty === "function_body" || ty === "lambda_literal" || ty === "anonymous_initializer") {
                for (const c of code(t, x)) {
                    if (t.start[c] >= t.start[below]) break;
                    if (t.type[c] === "property_declaration") {
                        for (const v of [kid(t, c, "variable_declaration"), ...code(t, kid(t, c, "multi_variable_declaration"))]) if (v >= 0 && nameOf(t, kid(t, v, "identifier")) === name) vs.push(value(code(t, v).find((y) => TYPE_NODES.has(t.type[y])) ?? -1));
                    } else if (t.type[c] === "function_declaration" && nameOf(t, child(t, c, "name")) === name) {
                        // A local extension needs a receiver around that it takes: maybe.
                        const tps = kid(t, c, "type_parameters");
                        const v = args.typeArgs >= 0 && args.typeArgs !== (tps >= 0 ? code(t, tps).length : 0) ? "no" : paramsFit(f, args, f, paramsOf(t, kid(t, c, "function_value_parameters")), tps >= 0);
                        vs.push(v === "sure" && kid(t, c, "receiver_type") >= 0 ? "maybe" : v);
                    } else if ((t.type[c] === "class_declaration" || t.type[c] === "object_declaration") && code(t, c).some((i) => t.type[i] === "identifier" && nameOf(t, i) === name)) vs.push(t.type[c] === "class_declaration" ? "maybe" : null);
                }
            }
            if (ty === "lambda_literal") {
                const lp = kid(t, x, "lambda_parameters");
                if (lp >= 0) {
                    for (const v of code(t, lp)) if (text(t, v).split(/[\s,():]+/).includes(name)) vs.push(t.type[v] === "variable_declaration" ? value(code(t, v).find((y) => TYPE_NODES.has(t.type[y])) ?? -1) : null);
                } else if (name === "it") vs.push(null);
            }
            if (ty === "function_declaration" || ty === "anonymous_function" || ty === "secondary_constructor") for (const p of paramsOf(t, kid(t, x, "function_value_parameters"))) if (p.name === name) vs.push(p.vararg ? null : value(p.type));
            if (ty === "class_declaration" && seesParams(t, x, n)) {
                const pc = kid(t, x, "primary_constructor");
                for (const p of code(t, pc >= 0 ? kid(t, pc, "class_parameters") : -1)) if (t.type[p] === "class_parameter" && nameOf(t, kid(t, p, "identifier")) === name) vs.push(value(code(t, p).find((y) => TYPE_NODES.has(t.type[y])) ?? -1));
            }
            // A loop's variable, a `when`'s subject (`when (val y = x)`): by their written types; a caught exception, a setter's value, a backing field: no function.
            if (ty === "for_statement" || ty === "when_expression") {
                for (const v of code(t, ty === "for_statement" ? x : kid(t, x, "when_subject"))) {
                    const vars = t.type[v] === "variable_declaration" ? [v] : t.type[v] === "multi_variable_declaration" ? code(t, v) : [];
                    for (const w of vars) if (nameOf(t, kid(t, w, "identifier")) === name) vs.push(value(code(t, w).find((y) => TYPE_NODES.has(t.type[y])) ?? -1));
                }
            }
            const id = ty === "catch_block" || ty === "setter" ? kid(t, x, "identifier") : -1;
            if ((id >= 0 && nameOf(t, id) === name) || (ty === "setter" && id < 0 && name === "value") || ((ty === "getter" || ty === "setter") && name === "field")) vs.push(null);
            if (vs.includes(null)) return null;
            if (vs.includes("sure")) return "sure";
            if (vs.includes("maybe")) best = "maybe";
        }
        return best;
    };

    /**
     * Whether whatever a receiver around may answer a bare call with before a
     * file's import of the name is known (and so, the name being no
     * contract's, has none): each receiver's members, an extension of the
     * package's read or a star import's of a package known.
     */
    const receiversFree = (f: KFile, n: number, name: string): boolean =>
        framesKnown(f, n, name) && (framesAt(f, n).length === 0 || f.o.imports.every((i) => !i.star || classesNamed(f, i.path.join(".")).length === 1 || pkgKnown(i.path.join("."))));

    /** Whether the members of the name every receiver around has are known: a class read's, or the standard library's or a known library's (none with a contract). */
    const framesKnown = (f: KFile, n: number, name: string): boolean => framesAt(f, n).every((fr) => fr.ty !== "unknown" && (fr.ty.k !== "class" ? fr.ty.k !== "param" : membersNamed(fr.ty.c, name) !== null));

    /** Whether no value of the name that a bare call may invoke instead is read where it sees one: a property not of a function type, or an object. */
    const valuesFree = (f: KFile, n: number, name: string, explicit: Import[]): boolean =>
        seen(f, n, name, explicit).every((k) => k.d.kind === "fun" || (k.d.kind === "prop" ? k.d.type >= 0 && k.f.t.type[stripType(k.f.t, k.d.type)] === "function_type" : isClass(k.d) && k.d.kind !== "object"));

    /** The declarations of a name read where a node sees it by the name alone: members of the receivers around, the imports' targets, the package's, the star imports'. */
    const seen = (f: KFile, n: number, name: string, explicit: Import[]): KDecl[] => [
        ...framesAt(f, n).flatMap((fr) => (fr.ty !== "unknown" && fr.ty.k === "class" ? (membersNamed(fr.ty.c, name) ?? []) : [])),
        ...explicit.flatMap((i) => importTargets(f, i.path) ?? []),
        ...(topByPkg.get(f.o.pkg) ?? []).filter((k) => k.d.name === name && !unseen(f.path, k.f.path)),
        ...(starInfo(f, name)?.decls ?? []),
    ];

    /** Whether a function of the name that may apply is read where a bare call sees it: a member of a receiver around, an import's target, the package's, a star import's. */
    const declaredRead = (f: KFile, n: number, name: string, explicit: Import[], args: Args): boolean => seen(f, n, name, explicit).some((k) => k.d.kind === "fun" && verdictOf(f, args, k) !== "no");

    /** Whether everything a bare name may call is read: receivers around of known members, explicit imports of read packages, the package's files (an unread one is out of reach), star imports known. */
    const sourcesRead = (f: KFile, n: number, name: string, explicit: Import[]): boolean => {
        for (const fr of framesAt(f, n)) {
            if (fr.ty === "unknown" || fr.ty.k !== "class") return false;
            if (membersNamed(fr.ty.c, name) === null) return false;
        }
        if (explicit.some((i) => importTargets(f, i.path) === null) || doubted(f.o.pkg, name)) return false;
        return starInfo(f, name) !== null;
    };

    /**
     * Whether a bare call surely calls a known library's function (kotlin.test,
     * kotlinx.coroutines, as LIB_NAMES lists them), none of which implies a
     * type without type arguments: imported by name or by a star from such a
     * package, with no local, receiver around, or declaration of the package
     * or another star import of the name.
     */
    const libBare = (f: KFile, n: number, name: string): boolean => {
        if (!LIB_NAMES.has(name) || LIB_CASTERS.has(name) || localNames(f, n).has(name)) return false;
        const explicit = importsOf(f, name);
        if (explicit.some((i) => i.alias !== null || !LIB_STARS.has(i.path.slice(0, -1).join(".")))) return false;
        const stars = f.o.imports.filter((i) => i.star);
        if (explicit.length === 0 && !stars.some((i) => LIB_STARS.has(i.path.join(".")))) return false;
        for (const fr of framesAt(f, n)) {
            if (fr.ty === "unknown" || fr.ty.k !== "class") return false;
            const m = membersNamed(fr.ty.c, name);
            if (m === null || m.length > 0) return false;
        }
        // An extension of the name in the package or a star import would come first, through a receiver around.
        if (doubted(f.o.pkg, name) || (topByPkg.get(f.o.pkg) ?? []).some((k) => k.d.name === name && !unseen(f.path, k.f.path))) return false;
        return stars.every((i) => {
            const pkg = i.path.join(".");
            if (LIB_STARS.has(pkg)) return true;
            return (repoPkgs.has(pkg) || doubtWords.has(pkg)) && !doubted(pkg, name) && !(topByPkg.get(pkg) ?? []).some((k) => k.d.name === name);
        });
    };

    /** Whether a member call's name surely is the default imports' extension: the receiver's type is known and has no member of the name. */
    const stdMember = (f: KFile, recv: number, name: string): boolean => {
        if (!STD_ANY_EXT.has(name)) return false;
        const ty = typeOf(f, recv);
        if (!ty || ty.k !== "class") return false;
        const m = membersNamed(ty.c, name);
        if (m === null || m.length > 0) return false;
        return noFileDeclaration(f, name);
    };

    /** Whether nothing a file sees at its own level declares a name: no import of it, no star import, nothing of its package read. */
    const noFileDeclaration = (f: KFile, name: string): boolean =>
        !doubted(f.o.pkg, name) && importsOf(f, name).length === 0 && starInfo(f, name)?.decls.length === 0 && !(topByPkg.get(f.o.pkg) ?? []).some((k) => k.d.name === name && !unseen(f.path, k.f.path)) && !enclosingExtension(f, name);

    /** Whether a class read declares a member extension of a name, which a receiver around may reach. */
    const enclosingExtension = (_f: KFile, _name: string): boolean => false;

    // ---- Members -------------------------------------------------------------------------------

    /**
     * The members of a class named `name`, its own and inherited (not private
     * ones of its supertypes), or null when a supertype isn't known or the
     * class has implicit members of the name (an enum's, a data class's).
     */
    const membersNamed = (c: KClass, name: string): KDecl[] | null => {
        if (ANY_MEMBERS.has(name)) return null;
        const a = ancestry(c);
        if (!a || libNames(c).has(name)) return null;
        const out: KDecl[] = [];
        for (const x of a) {
            if (x.d.kind === "enum" && ENUM_MEMBERS.has(name)) return null;
            if (x.d.mods.has("data") && DATA_MEMBER.test(name)) return null;
            // kotlinx.serialization's plugin gives a `@Serializable` class's companion (and such an object) `serializer()`.
            if (name === "serializer" && (x.d.annotations.includes("Serializable") || (x.d.kind === "companion" && x.d.owner?.annotations.includes("Serializable")))) return null;
            for (const d of x.d.members.get(name) ?? []) {
                if ((x !== c && d.mods.has("private")) || d.hidden) continue;
                out.push({ f: x.f, d });
            }
        }
        return out;
    };

    /**
     * Members without those a nearer class overrides: a member a subclass
     * declares `override` with the same parameters and type parameters stands
     * for the one it overrides. Overloads of one class all stay.
     */
    const derivedOnly = (c: KClass, ms: KDecl[]): KDecl[] => {
        const a = ancestry(c)!;
        const rank = (k: KDecl) => a.findIndex((x) => x.f === k.f && x.d === k.d.owner);
        const sorted = [...ms].sort((x, y) => rank(x) - rank(y));
        return sorted.filter((m) => !sorted.some((o) => rank(o) < rank(m) && o.d.mods.has("override") && sameSignature(o, m)));
    };

    const sameSignature = (a: KDecl, b: KDecl): boolean => {
        if (a.d.kind !== b.d.kind) return false;
        if (a.d.kind !== "fun") return true;
        if (a.d.params.length !== b.d.params.length || a.d.typeParams.length !== b.d.typeParams.length || (a.d.receiver >= 0) !== (b.d.receiver >= 0)) return false;
        return a.d.params.every((p, i) => text(a.f.t, stripType(a.f.t, p.type)).replace(/\s+/g, "") === text(b.f.t, stripType(b.f.t, b.d.params[i].type)).replace(/\s+/g, "") && nullable(a.f.t, p.type) === nullable(b.f.t, b.d.params[i].type));
    };

    // ---- Values ----------------------------------------------------------------------------------

    /** The local declaration a name at a node is: a parameter's or a local's node and its written type and value, or null when it's no local. */
    type Local = { type: number; init: number; mutable: boolean; f: KFile } | "other";
    const localDecl = (f: KFile, n: number, name: string): Local | null => {
        const t = f.t;
        let below = n;
        for (let x = t.parent[n]; x >= 0; below = x, x = t.parent[x]) {
            const ty = t.type[x];
            if (ty === "source_file" || CLASS_LIKE.has(ty)) {
                if (ty === "class_declaration" && seesParams(t, x, n)) {
                    // A primary constructor's parameter, its written type (a vararg one's is an array).
                    const pc = kid(t, x, "primary_constructor");
                    const list = pc >= 0 ? kid(t, pc, "class_parameters") : -1;
                    for (const p of list >= 0 ? code(t, list) : []) {
                        if (t.type[p] !== "class_parameter" || nameOf(t, kid(t, p, "identifier")) !== name) continue;
                        if (modifiersOf(t, p).has("vararg")) return "other";
                        return { type: code(t, p).find((y) => t.type[y] === "user_type" || t.type[y] === "nullable_type") ?? -1, init: -1, mutable: false, f };
                    }
                }
                if (ty !== "class_declaration") return null;
                continue;
            }
            if (ty === "block" || ty === "function_body" || ty === "lambda_literal") {
                // A local seen from the statement after it.
                for (const c of code(t, x)) {
                    if (t.start[c] >= t.start[below]) break;
                    if (t.type[c] === "property_declaration") {
                        const v = kid(t, c, "variable_declaration");
                        if (v >= 0 && nameOf(t, kid(t, v, "identifier")) === name) {
                            const d = { type: code(t, v).find((y) => t.type[y] === "user_type" || t.type[y] === "nullable_type") ?? -1, init: -1, mutable: token(t, c, "var") >= 0, f };
                            for (let y = t.first[c], eq = false; y >= 0; y = t.next[y]) {
                                if (!t.named[y] && t.type[y] === "=") eq = true;
                                else if (eq && t.named[y]) {
                                    d.init = y;
                                    break;
                                }
                            }
                            if (kid(t, c, "property_delegate") >= 0) return "other";
                            return d;
                        }
                        const mv = kid(t, c, "multi_variable_declaration");
                        if (mv >= 0 && code(t, mv).some((v2) => nameOf(t, kid(t, v2, "identifier")) === name)) return "other";
                    }
                    if ((t.type[c] === "function_declaration" || t.type[c] === "class_declaration" || t.type[c] === "object_declaration") && code(t, c).some((i) => t.type[i] === "identifier" && t.field[i] !== "" && nameOf(t, i) === name)) return "other";
                }
            }
            if (ty === "lambda_literal") {
                const lp = kid(t, x, "lambda_parameters");
                if (lp >= 0 ? text(t, lp).split(/[\s,():]+/).includes(name) : name === "it") return "other";
            }
            if (ty === "function_declaration" || ty === "anonymous_function" || ty === "secondary_constructor") {
                const p = paramsOf(t, kid(t, x, "function_value_parameters")).find((q) => q.name === name);
                // A vararg parameter is an array of its written type.
                if (p) return p.vararg ? "other" : { type: p.type, init: -1, mutable: false, f };
            }
            if ((ty === "getter" || ty === "setter") && name === "field") return "other";
            if (ty === "for_statement" || ty === "catch_block" || ty === "when_expression" || ty === "setter") {
                if (text(t, x).slice(0, Math.max(0, t.start[below] - t.start[x])).match(new RegExp(`(^|[^\\w$])${name.replace(/[$]/g, "\\$")}([^\\w$]|$)`))) return "other";
            }
        }
        return null;
    };

    /**
     * The values code around a node checks, casts or assigns (`x is T`,
     * `x as T`, `when (x) { is T -> }`, `x === y`, `x = …`, `assertIs<T>(x)`,
     * a call, an operator or an accessor that may have a contract), keyed by
     * the last name they're read by (`x`, `prop` of `this.obj.prop` or
     * `obj?.prop`, `this`): a smart cast may make such a value more than its
     * declared type where it's read after the cast, however it's spelled
     * there. A local `val y = x` aliases the two: a cast of either casts
     * both. Each cast has its node, and the node it leaves out: what it
     * casts is read there before the cast (`x` of `isB(x)`, of
     * `x.shouldBeInstanceOf<T>()`: a call casts once it returns).
     */
    /** A cast at a node, leaving out a node (-1: none); `call`, when only a call of a function with a contract would make it; `scope`, the code it reaches when only there; `read`, a property read by its name alone, which reaches `readScope`'s code. */
    type Cast = { at: number; own: number; call?: number; scope?: number; read?: number };
    const castMemo = new Map<string, Map<string, Cast[]>>();
    const castNames = (f: KFile, fn: number): Map<string, Cast[]> => {
        const key = `${f.path}#${fn}`;
        const hit = castMemo.get(key);
        if (hit) return hit;
        const t = f.t;
        const out = new Map<string, Cast[]>();
        const put = (name: string, cast: Cast) => (out.get(name) ?? out.set(name, []).get(name)!).push(cast);
        const add = (at: number, e: number, call = -1) => {
            const x = unwrap(t, e);
            const name = x >= 0 ? lastName(t, x) : null;
            if (name !== null) put(name, { at, own: x, ...(call >= 0 ? { call } : {}) });
        };
        // Locals that alias a value: `val y = x` (and `when (val y = x)`).
        const aliases: [string, string][] = [];
        const alias = (v: number, init: number) => {
            const id = kid(t, v, "identifier");
            const x = unwrap(t, init);
            const to = x >= 0 ? lastName(t, x) : null;
            if (id >= 0 && to !== null) aliases.push([nameOf(t, id), to]);
        };
        // A `when`'s subject, which an entry's test checks: `when (x)`, and `when (val y = x)`'s y and x.
        const subject = (x: number, call = -1) => {
            let w = t.parent[x];
            while (w >= 0 && t.type[w] !== "when_expression") w = t.parent[w];
            const subj = w >= 0 ? kid(t, w, "when_subject") : -1;
            const e = subj >= 0 ? (code(t, subj).find((c) => t.type[c] !== "annotation") ?? -1) : -1;
            if (e >= 0 && t.type[e] === "variable_declaration") {
                const id = kid(t, e, "identifier");
                if (id >= 0) put(nameOf(t, id), { at: x, own: -1, ...(call >= 0 ? { call } : {}) });
                const init = code(t, subj).find((c) => c !== e && t.type[c] !== "annotation") ?? -1;
                if (init >= 0) add(x, init, call);
            } else if (e >= 0) add(x, e, call);
        };
        const end = t.end[fn];
        for (let x = fn; x < t.count && t.start[x] < end; x++) {
            const ty = t.type[x];
            if (ty === "is_expression" || ty === "as_expression" || ty === "assignment") {
                add(x, code(t, x)[0] ?? -1);
                // A property set calls its setter, which may have a contract on what it's set to, unless it's proven one without (as the property's own read is).
                const left = unwrap(t, code(t, x)[0] ?? -1);
                const name = left >= 0 ? lastName(t, left) : null;
                if (ty === "assignment" && operatorOf(t, x) === "=" && name !== null && name !== "this" && (t.type[left] === "navigation_expression" || valueRead(t, left))) add(x, code(t, x)[1] ?? -1, casters.has(name) ? -1 : left);
            } else if (ty === "type_test") subject(x);
            else if (ty === "property_declaration") {
                const v = kid(t, x, "variable_declaration");
                const init = initOf(t, x);
                if (v >= 0 && init >= 0) alias(v, init);
            } else if (ty === "call_expression") {
                // A call with type arguments may be a contract's (`assertIs<T>(x)`), and so is a call of a function read with one: its arguments and receiver may be cast.
                const call = callOf(t, x);
                const nav = call && t.type[call.callee] === "navigation_expression" ? navOf(t, call.callee) : null;
                const name = !call ? "" : nav ? nameOf(t, nav.name) : t.type[call.callee] === "identifier" ? nameOf(t, call.callee) : "";
                if (call && (call.typeArgs >= 0 || casters.has(name) || LIB_CASTERS.has(name))) {
                    for (const a of call.args) add(x, argOf(t, a).value);
                    if (nav && nav.op !== "::") add(x, nav.receiver);
                    // A bare call of one: the implicit receiver.
                    else if (!nav && casters.has(name)) put("this", { at: x, own: call.callee });
                } else if (call) {
                    // Any other call may be of a function not read with a contract (`if (x.isDerived())`, `require(isOk(x))`, `x.assertOk()`, whose `returns()` holds wherever the call stands): a cast unless it's proven a function read without one, the standard library's or a known library's (`castByCall`).
                    for (const a of call.args) add(x, argOf(t, a).value, x);
                    if (nav && nav.op !== "::") add(x, nav.receiver, x);
                    // A bare one may be an extension of a receiver around with a contract: the receivers of the function it stands in.
                    else if (!nav) {
                        const scope = innermostCode(t, x);
                        put("this", { at: x, own: call.callee, call: x, ...(scope >= 0 ? { scope } : {}) });
                    }
                }
            } else if (ty === "binary_expression" && /^[!=]==$/.test(operatorOf(t, x))) {
                // `x === y`: each may be smart cast to the other's type (`==` casts nothing, kotlinc 2.4).
                add(x, child(t, x, "left"));
                add(x, child(t, x, "right"));
            } else if (ty === "binary_expression" && genericRead(t, x)) {
                // `assertIs<T>(x)` as a statement, which tree-sitter reads as `(assertIs < T) > (x)`: a call with type arguments, its argument and receiver cast.
                const right = child(t, x, "right");
                if (right >= 0) add(x, right);
                const left = child(t, child(t, x, "left"), "left");
                const nav = left >= 0 && t.type[left] === "navigation_expression" ? navOf(t, left) : null;
                if (nav) add(x, nav.receiver);
            } else if (ty === "navigation_expression" || ty === "identifier") {
                // A property read or set calls its accessor, which may have a contract: what it's read on (`x` of `x.isSp`; the receivers around for a bare `isSp`), unless it's proven one without (`castByCall`).
                const nav = navOf(t, x);
                const p = t.parent[x];
                const name = nameOf(t, nav ? nav.name : x);
                const call = casters.has(name) ? -1 : x;
                if (nav && nav.op !== "::" && !(t.type[p] === "call_expression" && code(t, p)[0] === x)) add(x, nav.receiver, call);
                else if (!nav && ty === "identifier" && valueRead(t, x)) put("this", { at: x, own: -1, ...(call >= 0 ? { read: x } : {}) });
            }
            // An operator's or an infix function's call: what it's called on and with, as a call's (`x isA T`, `x in box`, `-x`, `for (i in x)`, `val (a, b) = x`).
            const op = opCallOf(t, x);
            if (op) {
                const call = casters.has(op.name) || LIB_CASTERS.has(op.name) || (op.name === "component" && [...casters].some((c) => /^component\d+$/.test(c))) ? -1 : x;
                add(x, op.recv, call);
                for (const a of op.args) add(x, a, call);
                if (ty === "range_test") subject(x, call);
            }
        }
        // An alias's cast casts what it aliases, and the other way round, from the same place.
        for (let changed = true; changed; ) {
            changed = false;
            for (const [a, b] of aliases) {
                for (const [from, to] of [[a, b], [b, a]]) {
                    for (const c of out.get(from) ?? []) {
                        const list = out.get(to) ?? [];
                        if (list.some((d) => d.at === c.at)) continue;
                        put(to, { at: c.at, own: -1, ...(c.call !== undefined ? { call: c.call } : {}) });
                        changed = true;
                    }
                }
            }
        }
        castMemo.set(key, out);
        return out;
    };

    /**
     * Whether a value read at a node, by its last name (`x`, `prop`, `this`),
     * may be smart cast there: code of the declaration around checks, casts
     * or assigns a value of that name before the node. Code after it can't:
     * a loop's body starts from what its entry knows, and a lambda or a local
     * function from where it's written. Outside any function (a parameter's
     * default, a supertype's argument, an enum entry's), the class around's.
     */
    const mayCast = (f: KFile, n: number, name: string): boolean => {
        const t = f.t;
        // The outermost declaration around: its code is what flows into the name.
        let top = -1;
        for (let x = t.parent[n]; x >= 0; x = t.parent[x]) if (FUNCTIONS.has(t.type[x]) || t.type[x] === "property_declaration") top = x;
        if (top < 0) for (let x = t.parent[n]; x >= 0; x = t.parent[x]) if (CLASS_LIKE.has(t.type[x])) top = x;
        if (top < 0) top = 0;
        return (castNames(f, top).get(name) ?? []).some((c) => c.own !== n && t.start[c.at] < t.start[n] && (c.scope === undefined || within(t, n, c.scope)) && (c.call === undefined || castByCall(f, c.call)) && (c.read === undefined || within(t, n, readScope(f, c.read))));
    };

    /**
     * Whether a call may cast what it's called with: unless it's proven to be
     * a function read without a contract, or the standard library's (whose
     * contracts imply only nullability or pass a Boolean through), a function
     * not read may imply a type (`returns(true) implies (x is T)`).
     */
    const castCallMemo = new Map<string, boolean>();
    const castByCall = (f: KFile, x: number): boolean => {
        const key = `${f.path}#${x}`;
        const hit = castCallMemo.get(key);
        if (hit !== undefined) return hit;
        castCallMemo.set(key, true);
        const call = callOf(f.t, x);
        const op = call ? null : opCallOf(f.t, x);
        const target = call ? calleeOf(f, call) : "unknown";
        const bare = call && f.t.type[call.callee] === "identifier" ? call.callee : -1;
        const r = op ? !opFree(f, x, op.name, op.recv) : !call ? (navOf(f.t, x) ? !propFree(f, x) : readScope(f, x) !== -1) : target === "unknown" ? !(bare >= 0 && contractFree(f, bare, nameOf(f.t, bare), argsOf(f, call))) : target.kind === "std" ? false : casters.has(target.decl.d.name);
        castCallMemo.set(key, r);
        return r;
    };

    /**
     * Whether an operator's or an infix function's call on a receiver surely
     * calls what has no contract: no function read of the name has one; the
     * receiver's type is known (its members come first); a candidate is
     * known (a member, a local function, an extension read, the standard
     * library's own); and every source of an extension is read. `component`:
     * each `componentN` a destructuring declaration calls.
     */
    const opFree = (f: KFile, n: number, name: string, recv: number): boolean => {
        if (name === "component") return code(f.t, kid(f.t, n, "multi_variable_declaration")).every((_, i) => opFree(f, n, `component${i + 1}`, recv));
        if (casters.has(name) || LIB_CASTERS.has(name)) return false;
        const ty = typeOf(f, recv);
        if (!ty || ty.k === "param") return false;
        const explicit = importsOf(f, name);
        let known = localNames(f, n).has(name) || extRead(f, n, name, explicit);
        if (ty.k === "class") {
            const m = membersNamed(ty.c, name);
            // A data class's own `componentN`, one per property of its constructor.
            if (m === null) return ty.c.d.mods.has("data") && /^component\d+$/.test(name) && Number(name.slice(9)) <= (ty.c.d.ctors[0]?.params.length ?? 0);
            // Of the standard library's, only `to` takes any receiver.
            known ||= m.some((k) => k.d.kind === "fun") || name === "to";
        } else known ||= STD_OPS.has(name);
        return known && sourcesRead(f, n, name, explicit);
    };

    /** Whether a class has a member property of a name (an enum's `name`, a library supertype's too), none, or null when its members aren't known. */
    const propMember = (c: KClass, name: string): boolean | null => {
        if (libNames(c).has(name) || (ENUM_MEMBERS.has(name) && (ancestry(c) ?? [c]).some((a) => a.d.kind === "enum"))) return true;
        const m = membersNamed(c, name);
        return m === null ? null : m.some((k) => k.d.kind === "prop");
    };

    /** Whether a name read alone is declared where the reads see it: imported by name, the package's or a star import's (or a file not trusted may declare it there), a class read, the standard library's or a known library's. */
    const declaredAround = (f: KFile, x: number, name: string): boolean =>
        importsOf(f, name).length > 0 ||
        doubted(f.o.pkg, name) ||
        (topByPkg.get(f.o.pkg) ?? []).some((k) => k.d.name === name && !unseen(f.path, k.f.path)) ||
        (starInfo(f, name)?.decls.length ?? 1) > 0 ||
        lookupClassifier(f, x, name) !== null ||
        STD_TOP.has(name) ||
        STD_CLASSES.has(name) ||
        LIB_NAMES.has(name);

    /** Whether a package's declarations are known: a file of it read (one not read is out of reach), a known library's (no accessor has a contract), or Java's (none is a property). */
    const pkgKnown = (pkg: string): boolean => repoPkgs.has(pkg) || doubtWords.has(pkg) || LIB_STARS.has(pkg) || /^(javax?|android)(\.|$)/.test(pkg);

    /**
     * Whether every import that may bring a property of the name is of a
     * package known (a file not trusted counts: a contract in it names every
     * function and property it declares). With `none`, also that none brings
     * one read or one a file not trusted may declare.
     */
    const propsKnown = (f: KFile, name: string, none = false): boolean => {
        const props = (pkg: string) => none && (doubted(pkg, name) || (topByPkg.get(pkg) ?? []).some((k) => k.d.name === name && k.d.kind === "prop" && !unseen(f.path, k.f.path)));
        return f.o.imports.every((i) => {
            const path = i.path.join(".");
            if (i.star) return classesNamed(f, path).length === 1 || (pkgKnown(path) && !props(path));
            if (importName(i) !== name || JAVA_ONLY.test(`${path}.`)) return true;
            const targets = importTargets(f, i.path);
            return targets ? !(none && targets.some((k) => k.d.kind === "prop")) : pkgKnown(i.path.slice(0, -1).join(".")) && !props(i.path.slice(0, -1).join("."));
        });
    };

    /**
     * Whether reading or setting a property on a receiver (`x.p`) calls no
     * accessor with a contract: a static one a qualifier reaches (`Foo.BAR`);
     * a member property of the receiver's known class; else an extension one
     * read or the standard library's, every source of one known.
     */
    const propFree = (f: KFile, x: number): boolean => {
        const t = f.t;
        const nav = navOf(t, x)!;
        const name = nameOf(t, nav.name);
        if (casters.has(name)) return false;
        // `!x.p` read as `(!x).p`: x's.
        const recv = unwrap(t, nav.receiver);
        const q = qualifierClass(f, recv);
        if (q !== null) return q !== "unknown";
        const ty = typeOf(f, recv);
        if (!ty || ty.k !== "class") return false;
        const m = propMember(ty.c, name);
        if (m !== false) return m === true;
        // A receiver around may hold a member extension property of the name.
        return (extRead(f, x, name, importsOf(f, name), "prop") || STD_ANY_EXT.has(name)) && framesKnown(f, x, name) && propsKnown(f, name);
    };

    /**
     * Where reading or setting a property by its name alone may cast a
     * receiver around through an accessor with a contract: -1 nowhere (a
     * local, a class's name, a member property of the first receiver with
     * one of the name); else the code of the outermost receiver it may reach,
     * a lambda's for a lambda's receiver, the function's for another: one
     * whose members aren't known, or the outermost when an extension
     * property's source isn't known.
     */
    const readMemo = new Map<string, number>();
    const readScope = (f: KFile, x: number): number => {
        const key = `${f.path}#${x}`;
        const hit = readMemo.get(key);
        if (hit !== undefined) return hit;
        readMemo.set(key, 0);
        const t = f.t;
        const name = nameOf(t, x);
        const frames = framesAt(f, x);
        const q = /^[A-Z]/.test(name) && frames.length > 0 && !localNames(f, x).has(name) ? qualifierClass(f, x) : null;
        let scope = -1;
        if (frames.length > 0 && !localNames(f, x).has(name) && !(q && q !== "unknown")) {
            const whole = Math.max(0, innermostCode(t, x));
            const codeOf = (fr: Frame) => (fr.kind === "lambda" ? fr.node : whole);
            let known: boolean | undefined;
            let member = false;
            for (const fr of frames) {
                // The standard library's and known libraries' members have no contract.
                const m = fr.ty === "unknown" ? null : fr.ty.k === "class" ? propMember(fr.ty.c, name) : fr.ty.k === "param" ? null : false;
                if ((member = m === true)) break;
                // Its members aren't known, or an extension property from a source not known may take it.
                if (m === null || !(known ??= propsKnown(f, name))) scope = codeOf(fr);
            }
            // A name nothing read declares where it's read: a file not read may declare it, an extension property on any receiver around.
            if (!member && !declaredAround(f, x, name)) scope = codeOf(frames[frames.length - 1]);
        }
        readMemo.set(key, scope);
        return scope;
    };

    /** Whether an extension function (or, with `kind`, property) of the name is read where a call on an explicit receiver sees it (`seen`). */
    const extRead = (f: KFile, n: number, name: string, explicit: Import[], kind = "fun"): boolean => seen(f, n, name, explicit).some((k) => k.d.kind === kind && k.d.receiver >= 0);

    /** What an expression is known to be. */
    const tyMemo = new Map<string, Ty | null>();
    const typeOf = (f: KFile, e: number): Ty | null => {
        if (e < 0) return null;
        const key = `${f.path}#${e}`;
        if (tyMemo.has(key)) return tyMemo.get(key)!;
        tyMemo.set(key, null);
        const r = typeOfNow(f, e);
        tyMemo.set(key, r);
        return r;
    };
    const typeOfNow = (f: KFile, e: number): Ty | null => {
        const t = f.t;
        const ty = t.type[e];
        const lit = literalTypes(t, e);
        if (lit) return { k: "std", name: lit[0], nullable: false };
        switch (ty) {
            case "parenthesized_expression":
                return typeOf(f, code(t, e)[0] ?? -1);
            case "this_expression": {
                if (code(t, e).length > 0) return null;
                if (mayCast(f, e, "this")) return null;
                const fr = framesAt(f, e)[0];
                return fr && fr.ty !== "unknown" ? fr.ty : null;
            }
            case "unary_expression": {
                // `x!!`: x, not null.
                const arg = code(t, e)[0] ?? -1;
                if (token(t, e, "!!") < 0) return null;
                const inner = typeOf(f, arg);
                return inner ? { ...inner, nullable: false } : null;
            }
            case "as_expression": {
                const right = code(t, e)[1] ?? -1;
                const r = resolveType(f, right);
                return r && t.text.slice(t.start[e], t.end[e]).match(/\bas\?/) ? { ...r, nullable: true } : r;
            }
            case "identifier":
                return nameType(f, e, nameOf(t, e));
            case "navigation_expression": {
                const nav = navOf(t, e);
                if (!nav || nav.op === "::") return null;
                const name = nameOf(t, nav.name);
                const recv = receiverType(f, nav.receiver);
                if (!recv || recv.k !== "class" || (recv.nullable && nav.op === ".")) return null;
                const p = propertyOf(recv.c, name, { f, n: e, viaThis: t.type[nav.receiver] === "this_expression" });
                if (!p) return null;
                const pt = propertyType(p);
                if (mayCast(f, e, name)) return null;
                return pt && nav.op === "?." ? { ...pt, nullable: true } : pt;
            }
            case "call_expression": {
                const call = callOf(t, e);
                if (!call) return null;
                const callee = call.callee;
                const r = t.type[callee] === "identifier" ? resolveBareCall(f, callee, nameOf(t, callee), call) : ((): Resolved | null => {
                    const nav = navOf(t, callee);
                    return nav && nav.op !== "::" ? resolveMemberCall(f, nav.receiver, nav.op, nameOf(t, nav.name), call) : null;
                })();
                if (!r) return null;
                if (r.cls) return { k: "class", c: r.cls, nullable: false };
                if (r.decl.d.typeParams.length > 0) return null;
                const rt = r.decl.d.type >= 0 ? resolveType(r.decl.f, r.decl.d.type) : null;
                if (!rt || rt.k === "param") return null;
                const nav = navOf(t, callee);
                return nav?.op === "?." ? { ...rt, nullable: true } : rt;
            }
        }
        return null;
    };

    /** A receiver expression's type, a qualifier aside. */
    const receiverType = (f: KFile, e: number): Ty | null => typeOf(f, e);

    /** A property of a class by name: its own or inherited one, alone of its name. */
    const propertyOf = (c: KClass, name: string, at: At): KDecl | null => {
        const all = membersNamed(c, name);
        const ms = all ? usableBy(at, all) : null;
        if (!ms) return null;
        const props = derivedOnly(c, ms.filter((m) => m.d.kind === "prop"));
        if (props.length !== 1 || ms.some((m) => m.d.kind !== "prop" && m.d.kind !== "fun")) return null;
        return props[0];
    };

    /** A property's type: its written one, else its initializer's (a `val` of a constructor call or a literal). */
    const propertyType = (p: KDecl): Ty | null => {
        const d = p.d;
        if (d.receiver >= 0 || d.delegated || d.mods.has("vararg")) return null;
        if (d.type >= 0) {
            const r = resolveType(p.f, d.type);
            return r && r.k !== "param" ? r : null;
        }
        if (d.getter || d.init < 0) return null;
        return typeOf(p.f, d.init);
    };

    /** A name read as a value: a local's type, or a property's of a receiver around or of the file. */
    const nameType = (f: KFile, n: number, name: string): Ty | null => {
        const local = localDecl(f, n, name);
        if (local === "other") return null;
        if (local) {
            if (local.mutable) return null;
            const r = local.type >= 0 ? resolveType(f, local.type) : null;
            const ty = local.type >= 0 ? (r && r.k !== "param" ? r : null) : local.init >= 0 ? typeOf(f, local.init) : null;
            if (!ty || mayCast(f, n, name)) return null;
            return ty;
        }
        if (localNames(f, n).has(name)) return null;
        if (mayCast(f, n, name)) return null;
        // A cast of `this` may make a receiver around more than its declared type, with another property of the name.
        if (framesAt(f, n).length > 0 && mayCast(f, n, "this")) return null;
        // A property of a receiver around: the first receiver with a member of the name.
        for (const fr of framesAt(f, n)) {
            if (fr.ty === "unknown") return null;
            if (fr.ty.k !== "class") {
                if (fr.ty.k === "param") return null;
                continue;
            }
            if (fr.ty.nullable) return null;
            const ms = membersNamed(fr.ty.c, name);
            if (ms === null) return null;
            if (ms.length === 0) continue;
            const p = propertyOf(fr.ty.c, name, { f, n, viaThis: true });
            const pt = p ? propertyType(p) : null;
            return pt;
        }
        return null;
    };

    // ---- Calls -----------------------------------------------------------------------------------

    type Resolved = { decl: KDecl; cls?: KClass };

    /** How a call's arguments read: positional ones in order, named ones, and the trailing lambda. */
    type Args = { positional: number[]; named: Map<string, number>; lambda: number; spread: boolean; ok: boolean; typeArgs: number };
    const argsOf = (f: KFile, call: Call): Args => {
        const t = f.t;
        const out: Args = { positional: [], named: new Map(), lambda: call.lambda, spread: false, ok: true, typeArgs: call.typeArgs >= 0 ? code(t, call.typeArgs).length : -1 };
        for (const a of call.args) {
            const { name, spread, value } = argOf(t, a);
            if (spread) out.spread = true;
            if (name !== null) {
                if (out.named.has(name)) out.ok = false;
                out.named.set(name, value);
            } else {
                // Kotlin allows a positional argument after named ones only in its own position; read none such.
                if (out.named.size > 0) out.ok = false;
                out.positional.push(value);
            }
        }
        // `f(g<A, B>(x))`: tree-sitter reads the type arguments as two comparisons, so two arguments; the count isn't the compiler's.
        const op = (v: number) => (v >= 0 && t.type[v] === "binary_expression" ? operatorOf(t, v) : "");
        const ops = call.args.map((a) => op(argOf(t, a).value));
        if (ops.includes("<") && ops.includes(">")) out.ok = false;
        return out;
    };

    /**
     * Whether a function or a constructor applies to a call's arguments:
     * "no" when the arguments can't fill its parameters or a literal can't be
     * the parameter's type; "sure" when each argument's known type fits its
     * parameter's; "maybe" otherwise.
     */
    const verdictOf = (f: KFile, args: Args, k: KDecl): Verdict => {
        // Type arguments written: only a declaration with that many type parameters takes them (a constructor, its class's).
        if (args.typeArgs >= 0) {
            const tps = k.d.kind === "ctor" ? (ctorClass(k)?.d.typeParams.length ?? -1) : k.d.typeParams.length;
            if (tps !== args.typeArgs) return "no";
        }
        // An override or an actual takes defaults it doesn't write from what it overrides or actualizes.
        return paramsFit(f, args, k.f, k.d.params, k.d.typeParams.length > 0, inheritsDefaults(k));
    };

    /** How surely a call's arguments fit parameters written in a file (a generic declaration's surely at most "maybe"; `inherits`: a parameter it doesn't write may take a default all the same). */
    const paramsFit = (f: KFile, args: Args, pf: KFile, ps: readonly Param[], generic: boolean, inherits = false): Verdict => {
        if (!args.ok) return "maybe";
        const map = mapArgs(args, ps);
        if (!map) return "no";
        const used = new Set(map);
        let sure = !args.spread && !generic;
        for (let j = 0; j < ps.length; j++) {
            if (used.has(j) || ps[j].def || ps[j].vararg) continue;
            if (!inherits) return "no";
            sure = false;
        }
        const values = argValues(args);
        for (let i = 0; i < map.length; i++) {
            const fit = fits(f, values[i], pf, ps[map[i]]);
            if (fit === "no") return "no";
            if (fit === "maybe") sure = false;
        }
        return sure ? "sure" : "maybe";
    };

    /** Whether a function or constructor may take defaults it doesn't write: an override's from what it overrides, an actual's from its expect. */
    const inheritsDefaults = (k: KDecl): boolean => k.d.mods.has("override") || mppOf(k) === "actual";

    /** A call's argument values in order: positional ones, named ones, the trailing lambda. */
    const argValues = (args: Args): number[] => [...args.positional, ...args.named.values(), ...(args.lambda >= 0 ? [args.lambda] : [])];

    /** The parameter each argument fills (in `argValues`' order), as Kotlin maps them: positional ones in order (a vararg takes the rest), named ones by name, the trailing lambda the last; null when they can't. */
    const mapArgs = (args: Args, ps: readonly Param[]): number[] | null => {
        const out: number[] = [];
        let i = 0;
        for (let n = 0; n < args.positional.length; n++) {
            if (i >= ps.length) return null;
            out.push(i);
            if (!ps[i].vararg) i++;
        }
        const used = new Set(out);
        for (const name of args.named.keys()) {
            const j = ps.findIndex((p) => p.name === name);
            if (j < 0 || used.has(j)) return null;
            used.add(j);
            out.push(j);
        }
        if (args.lambda >= 0) {
            const j = ps.length - 1;
            if (j < 0 || used.has(j)) return null;
            used.add(j);
            out.push(j);
        }
        return out;
    };

    /** Whether an argument's value fits a parameter: by its literal kind, or its known class. */
    const fits = (f: KFile, v: number, pf: KFile, p: Param): Verdict => {
        const t = f.t;
        const vt = t.type[v === -1 ? 0 : v];
        const ptNode = stripType(pf.t, p.type);
        if (ptNode < 0) return "maybe";
        const isFn = pf.t.type[ptNode] === "function_type";
        if (vt === "annotated_lambda" || vt === "lambda_literal") {
            if (!isFn) return resolveType(pf, p.type)?.k === "class" && classIsPlain(resolveType(pf, p.type) as Ty & { k: "class" }) ? "no" : "maybe";
            // A lambda that names its parameters takes exactly that many; one that names none, none or one (`it`).
            const lam = vt === "annotated_lambda" ? kid(t, v, "lambda_literal") : v;
            const lp = lam >= 0 ? kid(t, lam, "lambda_parameters") : -1;
            const ftp = kid(pf.t, ptNode, "function_type_parameters");
            const arity = ftp >= 0 ? code(pf.t, ftp).length : -1;
            if (arity < 0) return "maybe";
            const written = lp >= 0 ? code(t, lp).length : -1;
            if (written >= 0 ? written !== arity : arity > 1) return "no";
            return "maybe";
        }
        const lit = v >= 0 ? literalTypes(t, v) : null;
        if (isFn) return lit ? "no" : "maybe";
        const pt = resolveType(pf, p.type);
        if (!pt) return "maybe";
        if (pt.k === "param") return "maybe";
        if (vt === "identifier" && text(t, v) === "null") return nullable(pf.t, p.type) ? "sure" : "no";
        // `Box<Base>` takes a `Box<Derived>` or not: the argument's type arguments aren't known.
        if (!lit && hasTypeArgs(pf.t, p.type)) return "maybe";
        if (lit) {
            // Surely the literal's own type or Any; maybe another it may be or another supertype (an Int is Serializable); never another type.
            if (pt.k === "std") return lit.includes(pt.name) ? (pt.name === lit[0] || pt.name === "Any" ? "sure" : "maybe") : LITERAL_SUPERS.has(pt.name) ? "maybe" : "no";
            return pt.k === "lib" && LITERAL_SUPERS.has(pt.name) ? "maybe" : "no";
        }
        const at = typeOf(f, v);
        if (!at || pt.k === "lib") return "maybe";
        if (pt.k === "std") {
            if (pt.name === "Any") return at.nullable && !pt.nullable ? "maybe" : "sure";
            return at.k === "std" && at.name === pt.name && (!at.nullable || pt.nullable) ? "sure" : "maybe";
        }
        if (at.k !== "class") return "maybe";
        if (at.nullable && !pt.nullable) return "maybe";
        const sub = isSubclass(at.c, pt.c);
        return sub === true ? "sure" : "maybe";
    };

    /** A class no lambda can be (no SAM conversion): not an interface. */
    const classIsPlain = (ty: Ty & { k: "class" }): boolean => ty.c.d.kind === "class" && !ty.c.d.mods.has("fun");

    /** Whether `Foo(…)` may call `invoke` on Foo's companion: a member `invoke` (its own, a supertype's, unknown ones) or an extension `invoke` the call sees. */
    const companionInvokes = (c: KClass, at: At): boolean => {
        if (!c.d.companion) return false;
        const comp = classOfDecl.get(c.d.companion);
        if (!comp) return true;
        const inv = membersNamed(comp, "invoke");
        if (!inv || inv.length > 0) return true;
        return extensionLevels(at.f, "invoke", comp, at).some((L) => L.unknown || L.weak || L.cands.length > 0 || (L.hidden?.length ?? 0) > 0);
    };

    /** A class's constructors as candidates of a call by its name; an interface, an object or an abstract class has none it can call. */
    const ctorCands = (c: KClass): KDecl[] | null => {
        const d = c.d;
        if (d.kind === "object" || d.kind === "companion" || d.kind === "annotation") return null;

        if (d.kind === "interface") return d.mods.has("fun") ? null : [];
        if (d.kind === "enum" || d.mods.has("abstract") || d.mods.has("sealed")) return [];
        if (d.mods.has("inner")) return null;
        return d.ctors.filter((x) => !x.hidden).map((x) => ({ f: c.f, d: x }));
    };

    /**
     * The one candidate a call takes from levels in order: the first level
     * with a candidate that may apply holds exactly one, and it surely
     * applies, or no level after it, known in full, has one of the name.
     */
    const pick = (f: KFile, args: Args, levels: Level[], name: string): KDecl | null => {
        for (let i = 0; i < levels.length; i++) {
            const L = levels[i];
            if (L.unknown) return (trace.why?.(`level ${i}: ${L.why ?? "unknown"}`), null);
            if (L.hidden?.some((k) => verdictOf(f, args, k) !== "no")) return (trace.why?.(`level ${i}: a candidate of unknown visibility may apply`), null);
            let live = actualsOver(f, L.cands).map((k) => ({ k, v: meet(verdictOf(f, args, k), L.fit?.get(k.d) ?? "sure") })).filter((x) => x.v !== "no");
            if (live.length === 0) {
                if (L.weak) return (trace.why?.(`level ${i}: ${L.why ?? "a property's invoke may apply"}`), null);
                continue;
            }
            if (live.length > 1) {
                const best = bestOf(args, live.map((x) => x.k));
                if (!best) return (trace.why?.(`level ${i}: ${live.length} candidates may apply`), null);
                live = live.filter((x) => x.k === best);
            }
            if (live[0].v === "sure") return live[0].k;
            if (L.weak) return (trace.why?.(`level ${i}: maybe, and ${L.why ?? "a property's invoke may apply"}`), null);
            for (const M of levels.slice(i + 1)) if (M.unknown || M.weak || [...M.cands, ...(M.hidden ?? [])].some((k) => meet(verdictOf(f, args, k), M.fit?.get(k.d) ?? "sure") !== "no")) return (trace.why?.(`maybe at level ${i}, then ${M.unknown ? (M.why ?? "unknown") : "another candidate"}`), null);
            void name;
            return live[0].k;
        }
        trace.why?.("no candidate");
        return null;
    };

    /** Whether a declaration is `expect` or `actual`, or in or of a class that is. */
    const mppOf = (k: KDecl): "expect" | "actual" | null => {
        let d: Decl | null = k.d.kind === "ctor" ? (ctorClass(k)?.d ?? null) : k.d;
        for (; d; d = d.owner) {
            if (d.mods.has("expect")) return "expect";
            if (d.mods.has("actual")) return "actual";
        }
        return null;
    };

    /** Candidates with an `expect` declaration dropped where its `actual` is one the place links to (a platform's code calls the `actual`). */
    const actualsOver = (f: KFile, ks: KDecl[]): KDecl[] => {
        const actuals = ks.filter((k) => mppOf(k) === "actual" && linkable(f, k));
        if (actuals.length === 0) return ks;
        // An expect's signature: its parameters' and receiver's types; one not known matches no actual.
        const sig = (k: KDecl): string | null => {
            const keys = [...k.d.params.map((p) => `${p.vararg ? "*" : ""}${typeKeyOfNode(k, p.type)}`), k.d.receiver >= 0 ? `recv:${typeKeyOfNode(k, k.d.receiver)}` : "-"];
            return keys.some((x) => x.includes("?unknown")) ? null : `${k.d.kind}:${k.d.name}:${keys.join("|")}`;
        };
        const covered = new Set(actuals.map(sig).filter((x): x is string => x !== null));
        return ks.filter((k) => {
            if (mppOf(k) !== "expect") return true;
            const s = sig(k);
            return s === null || !covered.has(s);
        });
    };

    const meet = (a: Verdict, b: Verdict): Verdict => (a === "no" || b === "no" ? "no" : a === "maybe" || b === "maybe" ? "maybe" : "sure");

    /**
     * Of candidates that all may apply, the one Kotlin picks when they give
     * every argument the same parameter type (a vararg's element type) and
     * the same receiver type, as kotlinc's overload resolver does: by shape,
     * one with no vararg over those with one, then the one using the fewest
     * defaults; failing a single one, among those with no type parameters
     * when generic ones compete, by shape again. Null when types differ
     * (which is more specific is a matter of subtypes) or none is left alone.
     */
    const bestOf = (args: Args, ks: KDecl[]): KDecl | null => {
        if (!args.ok || args.spread) return null;
        type Shape = { k: KDecl; varargs: boolean; defaults: number; generic: boolean };
        const all: Shape[] = [];
        let types: string | null = null;
        for (const k of ks) {
            const ps = k.d.params;
            const map = mapArgs(args, ps);
            if (!map) return null;
            const keys = map.map((j) => typeKeyOfNode(k, ps[j].type));
            if (k.d.receiver >= 0) keys.push(`recv:${typeKeyOfNode(k, k.d.receiver)}`);
            if (keys.some((x) => x.includes("?unknown"))) return null;
            const key = keys.join("|");
            if (types !== null && key !== types) return null;
            types = key;
            const used = new Set(map);
            if (inheritsDefaults(k) && ps.some((p, j) => !used.has(j) && !p.def && !p.vararg)) return null;
            all.push({ k, varargs: ps.some((p) => p.vararg), defaults: ps.filter((p, j) => p.def && !used.has(j)).length, generic: k.d.typeParams.length > 0 });
        }
        const notWorse = (a: Shape, b: Shape) => (a.varargs !== b.varargs ? !a.varargs : a.defaults <= b.defaults);
        const best = (pool: Shape[]): KDecl | null => {
            let m: Shape | null = null;
            for (const x of pool) if (!m || notWorse(x, m)) m = x;
            return m && !pool.some((o) => o !== m && notWorse(o, m)) ? m.k : null;
        };
        const byShape = best(all);
        if (byShape) return byShape;
        const plain = all.filter((x) => !x.generic);
        return plain.length > 0 && plain.length < all.length ? best(plain) : null;
    };

    /** A type as a key: a class's id, a default-import type's name, with their type arguments' keys; a function type's written text; "?unknown" when not known. */
    const typeKeyOfNode = (k: KDecl, node: number): string => {
        if (node < 0) return "?unknown";
        const x = stripType(k.f.t, node);
        const q = nullable(k.f.t, node) ? "?" : "";
        // A function type's names resolve in its own file: the same text in another file may name other types.
        if (x >= 0 && k.f.t.type[x] === "function_type") return `fn:${k.f.path}:${text(k.f.t, x).replace(/\s+/g, "")}${q}`;
        const r = resolveType(k.f, node);
        if (!r || r.k === "param") return "?unknown";
        const args = x >= 0 && k.f.t.type[x] === "user_type" ? typeParts(k.f.t, x).flatMap((part) => (part.args >= 0 ? code(k.f.t, part.args) : [])) : [];
        // Each type argument: its variance as written and its own key; a star projection as `*`.
        const argKeys = args.map((a) => {
            const at = k.f.t;
            const ty = code(at, a).find((c) => TYPE_NODES.has(at.type[c])) ?? -1;
            const variance = code(at, a).filter((c) => at.type[c] === "variance_modifier").map((c) => text(at, c)).join("");
            return ty < 0 ? (text(at, a).trim() === "*" ? "*" : "?unknown") : `${variance}${typeKeyOfNode(k, ty)}`;
        });
        return (r.k === "class" ? `class:${r.c.fqn}` : `${r.k}:${r.name}`) + (argKeys.length ? `<${argKeys.join(",")}>` : "") + q;
    };

    /** Whether a written type has type arguments (`Box<Base>`, `List<*>`). */
    const hasTypeArgs = (t: Flat, node: number): boolean => {
        const x = stripType(t, node);
        return x >= 0 && t.type[x] === "user_type" && typeParts(t, x).some((part) => part.args >= 0);
    };

    /** The candidates a class's members give a call: functions of the name, most derived first; a property of the name (an `invoke`) makes the level unknown. */
    const memberLevel = (c: KClass, name: string, at: At): Level => {
        const all = membersNamed(c, name);
        if (all === null) return stop(`members of ${c.d.name} unknown`);
        const { ok: ms, hidden } = split(at, all);
        // A member extension (`fun D.ext()` in the class) needs a second receiver: unknown here.
        if ([...ms, ...hidden].some((m) => m.d.kind === "fun" && m.d.receiver >= 0)) return stop(`${c.d.name} has a member extension ${name}`);
        // A nested class of the name, its own, a superclass's or an inner one: its constructor competes. An interface's nested class isn't seen past it.
        const chain = staticChain(c) ?? [];
        if ([...ms, ...hidden].some((m) => isClass(m.d) && (m.d.mods.has("inner") || chain.some((x) => x.d === m.d.owner)))) return stop(`${c.d.name} has a nested class ${name}`);
        const fns = derivedOnly(c, ms.filter((m) => m.d.kind === "fun"));
        const hiddenFns = hidden.filter((m) => m.d.kind === "fun");
        // A property of the name may be invoked when no function applies; one whose visibility is unknown, too.
        const weak = [...ms, ...hidden].some((m) => m.d.kind === "prop");
        return { cands: fns, unknown: false, ...(hiddenFns.length ? { hidden: hiddenFns } : {}), ...(weak ? { weak, why: `${c.d.name} has a property ${name}` } : {}) };
    };

    /**
     * The extensions of a name a receiver of a class may take, level by
     * level after its members: explicit imports, the package, star imports,
     * the default imports. Each candidate with how surely its receiver type
     * takes the class (`fit`); a member extension of a class around, or one
     * the default imports give any receiver, makes the lookup unknown.
     */
    const extensionLevels = (f: KFile, name: string, recv: KClass, at: At): Level[] => {
        if (STD_ANY_EXT.has(name)) return [stop(`default imports extend any receiver with ${name}`)];
        // Before the file's extensions: a local of the name (`fun A.ext()` in a block, a value of an extension function type), and the implicit receivers' member extensions, inherited ones too. A receiver whose members aren't all known may hold one.
        if (localNames(f, at.n).has(name)) return [stop(`a local ${name} may extend`)];
        if (framesAt(f, at.n).length > 0 && mayCast(f, at.n, "this")) return [stop(`a receiver around may be cast to a class with a member extension ${name}`)];
        for (const fr of framesAt(f, at.n)) {
            if (fr.ty === "unknown" || fr.ty.k !== "class") return [stop(`a receiver around whose members aren't known may extend with ${name}`)];
            const ms = membersNamed(fr.ty.c, name);
            if (ms === null || ms.some((m) => m.d.receiver >= 0 || m.d.kind === "prop")) return [stop(`a member extension ${name} of a receiver around`)];
        }
        const level = (ks: KDecl[]): Level => {
            const fit = new Map<Decl, Verdict>();
            const cands: KDecl[] = [];
            for (const k of ks) {
                if (k.d.receiver < 0 || (k.d.kind !== "fun" && k.d.kind !== "prop")) continue;
                const v = extensionFit(k, recv);
                if (v === "no") continue;
                fit.set(k.d, v);
                cands.push(k);
            }
            const { ok, hidden } = split(at, cands);
            // A property of the name may be invoked with the receiver: an extension property, or one of an extension function type.
            const props = ok.filter((k) => k.d.kind === "prop").length + ks.filter((k) => k.d.kind === "prop" && k.d.receiver < 0).length;
            return { cands: ok.filter((k) => k.d.kind === "fun"), unknown: false, fit, ...(hidden.length ? { hidden } : {}), ...(props ? { weak: true, why: `a property ${name} may be invoked` } : {}) };
        };
        const out: Level[] = [];
        const explicit = importsOf(f, name);
        if (explicit.length > 0) {
            const ks: KDecl[] = [];
            for (const i of explicit) {
                const got = importTargets(f, i.path);
                if (got === null) return [...out, stop(`import ${i.path.join(".")} not read`)];
                ks.push(...got);
            }
            out.push(level(ks));
        }
        if (doubted(f.o.pkg, name)) return [...out, stop(`an untrusted file of the package may declare ${name}`)];
        out.push(level((topByPkg.get(f.o.pkg) ?? []).filter((k) => k.d.name === name && !unseen(f.path, k.f.path))));
        const star = starInfo(f, name);
        if (star === null) return [...out, stop(`a star import may extend with ${name}`)];
        // A known library's extensions take library types alone: a class with a library supertype may be one.
        if (star.lib && libTypes(recv)) return [...out, stop("a library's star import may extend a library supertype")];
        out.push(level(star.decls));
        // A file that reaches what it can't see (`@Suppress("INVISIBLE_MEMBER")`) may take the standard library's internal extensions.
        if (f.unhides) out.push(stop("the file reaches declarations it can't see"));
        return out;
    };

    /** How surely an extension's receiver type takes a class: the class or a supertype ("sure"), a class it surely isn't ("no"), else "maybe". */
    const extensionFit = (k: KDecl, recv: KClass): Verdict => {
        const r = resolveType(k.f, k.d.receiver);
        if (!r || r.k === "param" || !ancestry(recv)) return "maybe";
        // A library type takes a class with library supertypes, or one it is implicitly: an enum is an Enum, Comparable and Serializable, an annotation class an Annotation.
        if (r.k === "lib") return libTypes(recv) || implicitSupers(recv).has(r.name) ? "maybe" : "no";
        if (r.k === "std") return r.name === "Any" ? "sure" : libTypes(recv) || implicitSupers(recv).has(r.name) ? "maybe" : "no";
        const sub = isSubclass(recv, r.c);
        // `fun Box<Foo>.ext()` takes a `Box<Bar>` or not: the receiver's type arguments aren't known.
        if (sub === true && hasTypeArgs(k.f.t, k.d.receiver)) return "maybe";
        return sub === true ? "sure" : sub === false ? "no" : "maybe";
    };

    /** The library types a class is without writing them: an enum's (`Enum<E>`, `Comparable<E>`, `Serializable`), an annotation class's (`Annotation`). */
    const implicitSupers = (c: KClass): Set<string> => {
        const out = new Set<string>();
        for (const x of ancestry(c) ?? [c]) {
            if (x.d.kind === "enum") for (const n of ["Enum", "Comparable", "Serializable", "java.io.Serializable", "java.lang.Enum", "java.lang.Comparable"]) out.add(n);
            if (x.d.kind === "annotation") for (const n of ["Annotation", "java.lang.annotation.Annotation"]) out.add(n);
        }
        return out;
    };

    /** The file's levels for a bare call: explicit imports, the package, star imports, the default imports. */
    const fileLevels = (f: KFile, name: string, at: At): Level[] => {
        const out: Level[] = [];
        const explicit = importsOf(f, name);
        if (explicit.length > 0) {
            const cands: KDecl[] = [];
            for (const i of explicit) {
                const got = importTargets(f, i.path);
                if (got === null) return [...out, stop(`import ${i.path.join(".")} not read`)];
                cands.push(...got);
            }
            out.push(callCands(cands, at));
        }
        if (doubted(f.o.pkg, name)) return [...out, stop(`an untrusted file of the package may declare ${name}`)];
        const pkg = (topByPkg.get(f.o.pkg) ?? []).filter((k) => k.d.name === name && !unseen(f.path, k.f.path));
        out.push(callCands(pkg, at));
        const star = starInfo(f, name);
        if (star === null) out.push(stop(`a star import may hold ${name}`));
        else if (star.decls.length > 0) out.push(callCands(star.decls, at));
        // The default imports' public names; any name in a file that reaches internal ones.
        if (STD_TOP.has(name) || STD_CLASSES.has(name) || f.unhides) out.push(stop(`default imports hold ${name}`));
        return out;
    };

    /** A level's candidates for a call from declarations of the name: functions that extend nothing, and classes' constructors; a property (an `invoke`) or a class that can't be called makes it unknown. */
    const callCands = (ks: KDecl[], at: At): Level => {
        const all: KDecl[] = [];
        let weak = false;
        for (const k of ks) {
            if (k.d.kind === "fun") {
                // An extension needs a receiver here: an implicit one (another level), or none.
                if (k.d.receiver < 0) all.push(k);
                continue;
            }
            if (isClass(k.d)) {
                const c = classOfDecl.get(k.d)!;
                const cs = ctorCands(c);
                if (cs === null) return stop(`${c.d.name} can't be called by name`);
                if (companionInvokes(c, at)) return stop(`${c.d.name}'s companion may be invoked`);
                if (access(at, k) === "no") continue;
                if (access(at, k) === "unknown") return stop(`class ${c.d.name} may be visible`);
                all.push(...cs);
                continue;
            }
            if (k.d.kind === "alias") return stop(`${k.d.name} is a type alias`);
            if (k.d.kind === "prop" && access(at, k) !== "no") weak = true;
        }
        const { ok, hidden } = split(at, all);
        return { cands: ok, unknown: false, ...(hidden.length ? { hidden } : {}), ...(weak ? { weak, why: "a property of the name may be invoked" } : {}) };
    };

    /** What an import's path names among the files read: a class and the top-level functions and properties of the name; null when its package isn't read or something there is unknown. */
    const importTargets = (f: KFile, path: readonly string[]): KDecl[] | null => {
        const name = path[path.length - 1];
        const pkg = path.slice(0, -1).join(".");
        if (doubted(pkg, name) || doubted(path.slice(0, -2).join("."), path[path.length - 2] ?? "")) return null;
        const out: KDecl[] = [];
        for (const c of importedClasses(f, path)) out.push({ f: c.f, d: c.d });
        for (const k of topByPkg.get(pkg) ?? []) if (k.d.name === name && !isClass(k.d) && !unseen(f.path, k.f.path)) out.push(k);
        // A member of an object (or a companion), or an enum's entry: `import a.B.c`.
        const outer = importedClasses(f, path.slice(0, -1));
        if (outer.length > 1) return null;
        if (outer.length === 1) for (const d of outer[0].d.members.get(name) ?? []) if (!isClass(d)) out.push({ f: outer[0].f, d });
        return out.length > 0 ? out : null;
    };

    /** The ctor's class, for a constructor candidate. */
    const ctorClass = (k: KDecl): KClass | null => {
        if (k.d.kind !== "ctor") return null;
        for (const c of k.f.o.classes) if (c.ctors.includes(k.d)) return classOfDecl.get(c) ?? null;
        return null;
    };

    /**
     * A bare call `name(…)`: locals stop it; each implicit receiver's
     * members, then the extensions any receiver may take, then the file's
     * levels. A receiver whose members aren't all known stops it.
     */
    const resolveBareCall = (f: KFile, n: number, name: string, call: Call): Resolved | null => {
        if (localNames(f, n).has(name)) return (trace.why?.("a local of the name"), null);
        const levels: Level[] = [];
        const frames = framesAt(f, n);
        const marked = new Set<string>();
        for (const fr of frames) {
            if (fr.ty === "unknown") {
                levels.push(stop(`receiver of a ${fr.kind} unknown (${f.t.type[fr.node]} at line ${f.t.lineStarts.findIndex((x) => x > f.t.start[fr.node])})`));
                break;
            }
            if (fr.ty.k !== "class") {
                // A receiver of a default-import type or a type parameter: its members aren't listed.
                levels.push(stop(`receiver of a ${fr.kind} is ${fr.ty.k === "std" ? fr.ty.name : "a type parameter"}`));
                break;
            }
            // A nullable receiver (`fun A?.g()`, an `A?.()` lambda) takes no member call: the name goes on to what's past it.
            if (fr.ty.nullable) {
                levels.push(stop(`a nullable receiver of a ${fr.kind}`));
                break;
            }
            // A companion's members come after the nested classes of its class's static scope: a classifier of the name competes.
            if (fr.kind === "companion" && fr.ty.c.d.owner) {
                const owner = classOfDecl.get(fr.ty.c.d.owner);
                const nested = owner ? staticNested(owner, name, null) : null;
                if (!nested || nested.length > 0) {
                    levels.push(stop(`a nested class ${name} competes with ${fr.ty.c.d.name}'s members`));
                    break;
                }
            }
            if (mayCast(f, n, "this")) {
                levels.push(stop("this may be smart cast"));
                break;
            }
            // A DSL marker an inner receiver shares hides this receiver's members.
            const ms = markersOf(fr.ty.c);
            if ([...ms].some((m) => marked.has(m))) {
                levels.push(stop(`a DSL marker hides ${fr.ty.c.d.name}`));
                break;
            }
            for (const m of ms) marked.add(m);
            levels.push(memberLevel(fr.ty.c, name, { f, n, viaThis: true }));
            levels.push(...extensionLevels(f, name, fr.ty.c, { f, n, viaThis: false }));
            // Inside a class, its own nested classes and its companion's are called by name before the file's.
            levels.push(nestedCtorLevel(fr.ty.c, name, { f, n, viaThis: true }));
        }
        // Classes around that aren't receivers here (outer classes of a nested one) still lend their nested classes.
        levels.push(...outerNestedLevels(f, n, name));
        levels.push(...fileLevels(f, name, { f, n, viaThis: false }));
        const k = pick(f, argsOf(f, call), levels, name);
        if (!k || !linkable(f, k)) return null;
        const cls = ctorClass(k) ?? undefined;
        return { decl: k, ...(cls ? { cls } : {}) };
    };

    /** A class's nested classes of the name, as constructor candidates (inside the class). */
    const nestedCtorLevel = (c: KClass, name: string, at: At): Level => {
        const nested = staticNested(c, name, at);
        if (nested === null) return stop(`nested classes of ${c.d.name} unknown`);
        if (nested.length === 0) return { cands: [], unknown: false };
        return callCands(nested.map((x) => ({ f: x.f, d: x.d })), at);
    };

    /** The nested-class levels of the classes around a node that aren't receivers there. */
    const outerNestedLevels = (f: KFile, n: number, name: string): Level[] => {
        const out: Level[] = [];
        for (let x = f.t.parent[n]; x >= 0; x = f.t.parent[x]) {
            if (!CLASS_LIKE.has(f.t.type[x]) || placeIn(f.t, x, n) === "header") continue;
            const c = classAt(f, x);
            if (!c) {
                out.push(stop("an object literal or enum entry around"));
                return out;
            }
            out.push(nestedCtorLevel(c, name, { f, n, viaThis: true }));
        }
        return out;
    };

    /**
     * A member call `r.name(…)`: the receiver's type known, its members of
     * the name (inherited ones too), then its extensions. `Foo.name(…)`
     * names an object's member, or a companion's, or a nested class.
     */
    const resolveMemberCall = (f: KFile, recv: number, op: string, name: string, call: Call): Resolved | null => {
        const t = f.t;
        const args = argsOf(f, call);
        const q = qualifierClass(f, recv);
        if (q === "unknown") return (trace.why?.("qualifier unknown"), null);
        if (q) {
            // `Foo.name(…)`: a nested class's constructor, or the object's or the companion's member; an enum's own `values()`, `valueOf()` and `entries` come first.
            if (q.d.kind === "enum" && ENUM_STATICS.has(name)) return (trace.why?.(`the enum's own ${name}`), null);
            const levels: Level[] = [];
            const nested = nestedNamed(q, name, false, { f, n: recv, viaThis: false });
            if (nested === null) return null;
            if (nested.length > 0) levels.push(callCands(nested.map((x) => ({ f: x.f, d: x.d })), { f, n: recv, viaThis: false }));
            const holder = q.d.kind === "object" || q.d.kind === "companion" ? q : q.d.companion ? classOfDecl.get(q.d.companion)! : null;
            if (holder) {
                if (nested.length > 0 && membersNamed(holder, name)?.length !== 0) return null;
                levels.push(memberLevel(holder, name, { f, n: recv, viaThis: false }));
                levels.push(...extensionLevels(f, name, holder, { f, n: recv, viaThis: false }));
            } else if (q.d.kind === "enum") return null;
            const k = pick(f, args, levels, name);
            if (!k || !linkable(f, k)) return null;
            const cls = ctorClass(k) ?? undefined;
            return { decl: k, ...(cls ? { cls } : {}) };
        }
        const ty = receiverType(f, recv);
        if (!ty || ty.k !== "class") return (trace.why?.(`receiver ${ty ? (ty.k === "std" ? ty.name : "a type parameter") : "type unknown"}: ${text(t, recv).slice(0, 40)}`), null);
        // A nullable receiver read with `.` takes an extension of a nullable type, or a smart cast made it not null.
        if (ty.nullable && op === ".") return (trace.why?.("nullable receiver with ."), null);
        if (t.type[recv] === "identifier" && mayCast(f, recv, nameOf(t, recv))) return (trace.why?.("receiver may be smart cast"), null);
        const k = pick(f, args, [memberLevel(ty.c, name, { f, n: recv, viaThis: t.type[recv] === "this_expression" }), ...extensionLevels(f, name, ty.c, { f, n: recv, viaThis: false })], name);
        if (!k || !linkable(f, k)) return null;
        return { decl: k };
    };

    /**
     * The class a receiver names as a qualifier (`Foo` in `Foo.bar()`), null
     * when it's a value, or "unknown" when it may be either. A name is a value
     * first: a local, a property of a receiver, of the file; else a class.
     */
    const qualifierClass = (f: KFile, recv: number): KClass | null | "unknown" => {
        const t = f.t;
        if (t.type[recv] === "identifier") {
            const name = nameOf(t, recv);
            if (!/^[A-Z]/.test(name)) return null;
            if (localNames(f, recv).has(name)) return "unknown";
            if (framesAt(f, recv).length > 0 && mayCast(f, recv, "this")) return "unknown";
            for (const fr of framesAt(f, recv)) {
                if (fr.ty === "unknown" || fr.ty.k !== "class") return "unknown";
                const ms = membersNamed(fr.ty.c, name);
                if (ms === null) return "unknown";
                if (ms.some((m) => !isClass(m.d))) return "unknown";
            }
            if (doubted(f.o.pkg, name) || (topByPkg.get(f.o.pkg) ?? []).some((k) => k.d.name === name && k.d.kind === "prop")) return "unknown";
            // An extension property of the name on a receiver around comes before any class (`val Box.Color`), an import's or a star import's too.
            if (framesAt(f, recv).length > 0 && !propsKnown(f, name, true)) return "unknown";
            const found = lookupClassifier(f, recv, name);
            const c = found ? platformClass(f, found) : null;
            if (!c) return "unknown";
            // A class the star imports bring loses to a value of the name they bring (a value is read first at each level).
            if (!c.d.owner && c.f.o.pkg !== f.o.pkg && importsOf(f, name).length === 0) {
                const star = starInfo(f, name);
                if (!star || star.decls.some((k) => k.d.kind === "prop")) return "unknown";
            }
            return c;
        }
        const nav = navOf(t, recv);
        if (nav && nav.op === "." && /^[A-Z]/.test(nameOf(t, nav.name))) {
            const outer = qualifierClass(f, nav.receiver);
            if (outer === "unknown" || outer === null) return outer === null && t.type[nav.receiver] !== "identifier" ? null : "unknown";
            const nested = nestedNamed(outer, nameOf(t, nav.name), false, { f, n: nav.name, viaThis: false });
            if (!nested || nested.length !== 1) return "unknown";
            return nested[0];
        }
        return null;
    };

    // ---- Sites -----------------------------------------------------------------------------------

    const named = (u: Unit | undefined, ref: Named[number]["ref"], alt?: Unit): Named => (u ? [{ ref, units: [u], ...(alt && alt !== u ? { alt } : {}) }] : []);

    /** A type site: an identifier in a `user_type`. */
    const typeSite = (f: KFile, n: number): Named => {
        const t = f.t;
        const ut = t.parent[n];
        const parts = typeParts(t, ut).map((p) => p.name);
        const i = parts.indexOf(n);
        if (i < 0) return [];
        const c = i === 0 ? (parts.length === 1 ? lookupClassifier(f, n, nameOf(t, n)) : qualifiedHead(f, parts)) : qualifiedClass(f, parts.slice(0, i + 1));
        if (!c || !linkable(f, c)) return [];
        const out = named(unitOf(c), "type");
        // `class A : B(…)`: B's constructor too.
        const ci = t.parent[ut];
        if (i === parts.length - 1 && t.type[ci] === "constructor_invocation" && (t.type[t.parent[ci]] === "delegation_specifier" || t.type[t.parent[ci]] === "annotation")) {
            if (t.type[t.parent[ci]] === "annotation") return out;
            const cs = ctorCands(c);
            if (!cs || cs.length === 0) {
                // An abstract or sealed superclass: its constructors are what the subclass calls.
                const any = c.d.ctors.map((x) => ({ f: c.f, d: x }));
                const vargs = kid(t, ci, "value_arguments");
                const call: Call = { node: ci, callee: ut, typeArgs: -1, args: vargs >= 0 ? code(t, vargs).filter((a) => t.type[a] === "value_argument") : [], lambda: -1 };
                const live = any.filter((k) => verdictOf(f, argsOf(f, call), k) !== "no");
                if (live.length === 1 && c.d.kind === "class") out.push(...named(ctorUnit(live[0], c), "call", unitOf(c)));
                return out;
            }
            const vargs = kid(t, ci, "value_arguments");
            const call: Call = { node: ci, callee: ut, typeArgs: -1, args: vargs >= 0 ? code(t, vargs).filter((a) => t.type[a] === "value_argument") : [], lambda: -1 };
            const live = cs.filter((k) => verdictOf(f, argsOf(f, call), k) !== "no");
            if (live.length === 1) out.push(...named(ctorUnit(live[0], c), "call", unitOf(c)));
        }
        return out;
    };

    /** The first part of a qualified type, when it names a class (not a package). */
    const qualifiedHead = (f: KFile, parts: number[]): KClass | null => {
        const name = nameOf(f.t, parts[0]);
        if (typeParamsAround(f, parts[0]).has(name)) return null;
        return lookupClassifier(f, parts[0], name);
    };

    /** An import's last name: the one declaration read that it names. */
    const importSite = (f: KFile, n: number): Named => {
        const imp = f.o.imports.find((i) => i.nameNode === n);
        if (!imp || imp.star) return [];
        const got = importTargets(f, imp.path);
        if (!got || got.length !== 1 || !linkable(f, got[0])) return [];
        const k = got[0];
        return named(unitOf(k), "import");
    };

    /** A bare or member name standing as a value: a class or object named as a qualifier (`Foo.bar`, `Foo::class`). */
    const valueSite = (f: KFile, n: number): Named => {
        const t = f.t;
        const p = t.parent[n];
        const nav = navOf(t, p);
        if (nav && nav.receiver === n && /^[A-Z]/.test(nameOf(t, n))) {
            const c = qualifierClass(f, n);
            return c && c !== "unknown" && linkable(f, c) ? named(unitOf(c), "type") : [];
        }
        if (nav && nav.name === n && nav.op === "." && /^[A-Z]/.test(nameOf(t, n)) && t.type[t.parent[p]] === "navigation_expression") {
            // `Outer.Inner.x`: Inner as a qualifier.
            const c = qualifierClass(f, p);
            return c && c !== "unknown" && linkable(f, c) ? named(unitOf(c), "type") : [];
        }
        return [];
    };

    /** A name called: `name(…)` or `r.name(…)`. */
    const callSite = (f: KFile, n: number, call: Call): Named => {
        const t = f.t;
        let r: Resolved | null = null;
        if (call.callee === n) r = resolveBareCall(f, n, nameOf(t, n), call);
        else {
            const nav = navOf(t, call.callee);
            if (!nav || nav.name !== n || nav.op === "::") return [];
            r = resolveMemberCall(f, nav.receiver, nav.op, nameOf(t, n), call);
        }
        if (!r) return [];
        if (r.cls) return named(ctorUnit(r.decl, r.cls), "call", unitOf(r.cls));
        return named(unitOf(r.decl), "call");
    };

    return (g: GFile, s: GSite): Named => {
        const f = kfiles.get(g);
        if (!f || f.doubt) return [];
        const t = f.t;
        const n = s.node;
        // An annotation on a type (`Map<@A(B::class) K, V>`): read nowhere else, so drawn nowhere.
        for (let x = t.parent[n]; x >= 0; x = t.parent[x]) if (t.type[x] === "type_modifiers") return [];
        if (s.ref === "import") return importSite(f, n);
        const p = t.parent[n];
        if (t.type[p] === "user_type") return typeSite(f, n);
        // The callee of a call: the name itself, or the name a navigation ends with.
        const head = t.type[p] === "navigation_expression" && navOf(t, p)?.name === n ? p : n;
        const ca = callAround(t, head);
        if (ca >= 0) {
            const call = callOf(t, ca);
            if (call && call.callee === head) return callSite(f, n, call);
        }
        return valueSite(f, n);
    };
};

const within = (t: Flat, n: number, outer: number): boolean => {
    if (outer < 0) return false;
    for (let x = n; x >= 0; x = t.parent[x]) if (x === outer) return true;
    return false;
};


