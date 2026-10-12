/**
 * PHP's names over one resolution's files: classes by namespace, `use` and
 * Composer's PSR-4 map; members through the class, its traits, its parents
 * and its interfaces, in PHP's order; and what an expression holds, from
 * native declarations alone (parameter, property and return types, `new`).
 * What the files read can't prove is null, and names nothing: a class or
 * a supertype not read, a name declared twice or in a block, a trait's
 * adapted names, a method `__call` might take instead (one not declared, or
 * not visible from the call), a private method of the calling class's name,
 * which PHP may run instead, an enum's own `cases`, `from` and `tryFrom`,
 * `$this` or `self` in a closure (`Closure::bind` rebinds them), a trait
 * (they mean the class using it) or an anonymous class, a receiver a class
 * test, a comparison, an assertion or an assignment may narrow to a class
 * reaching another method (`narrowing.ts`), `static` on such a receiver or
 * from `Base::m()`, a variable no write proves (`variables.ts`) or one
 * passed to a call that may take it by reference: a callable value, a
 * function or method not read, PHP's own not listed (`builtins.ts`); and a
 * property or a call's result given, or what it hangs off given (`$this`
 * for `$this->item`), to a call whose PHPDoc may assert its type unseen,
 * one not read but PHPUnit's, webmozart's and beberlei's assertions.
 */

import type { GFile } from "../../anyfacts.ts";
import type { ModuleContext } from "../../anylink.ts";
import { child, children, namedChildren, prevSibling, textOf } from "../../syntax.ts";
import type { Unit } from "../pack.ts";
import { ASSERT_CLASSES, BUILTINS, PHPUNIT } from "./builtins.ts";
import { classFiles } from "./composer.ts";
import { assertedOn, callName, otherTests, passesOf, testsOf, testsWith } from "./narrowing.ts";
import { classNameNode, FUNCTIONS, modifiers, nameText } from "./nodes.ts";
import { outlineOf, spaceAt, type ClassDecl, type Member, type Outline } from "./outline.ts";
import { CALLS, PHP_RULES } from "./rules.ts";
import { LOOPS, reachOf, VAR_TAG, varsOf } from "./variables.ts";

export type PFile = { f: GFile; t: GFile["flat"]; o: Outline };
export type PClass = { file: PFile; d: ClassDecl; unit: Unit | undefined };
/** A member found on a class: where it is written (`owner`, a trait's for a trait's member) and the class that has it (`host`). */
export type Found = { m: Member; owner: PClass; host: PClass };
/** Found; "none" when every class-like searched is read and none has it; null when it can't be told. */
type Look = Found | "none" | null;
/** Who calls: a class, none (a function or the file's code), or "?" for a closure's or a trait's code, whose class isn't known. */
type Scope = PClass | null | "?";

const MAX_DEPTH = 24;

/** Adds a value to a key's list. */
const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => map.set(key, [...(map.get(key) ?? []), value]);

export const createProgram = (files: readonly GFile[], ctx: ModuleContext, miss?: (path: string) => void) => {
    const composer = ctx.text("composer.json");
    const pfiles = new Map<string, PFile>();
    const ofDecl = new Map<ClassDecl, PClass>();
    /** Every named class-like of the files read, by lowercase name. */
    const declared = new Map<string, PClass[]>();
    for (const f of files) {
        const pf: PFile = { f, t: f.flat, o: outlineOf(f.flat) };
        pfiles.set(f.path, pf);
        for (const d of pf.o.byNode.values()) {
            const c: PClass = { file: pf, d, unit: f.unitByNode.get(d.node) };
            ofDecl.set(d, c);
            const key = d.fqn.toLowerCase();
            if (key) push(declared, key, c);
        }
    }
    // The functions of the files read by lowercase full name; what the PHPDoc of a function or method asserts the type of (`@phpstan-assert`, `@psalm-assert`), by lowercase name; the private methods' names; each file's `use function` names.
    const fns = new Map<string, [PFile, number][]>();
    const asserts = new Map<string, [number, string][]>();
    const privates = new Set<string>();
    const fnUses = new Map<PFile, Map<string, string>>();
    for (const pf of pfiles.values()) {
        const t = pf.t;
        for (let n = 0; n < t.count; n++) {
            if (t.type[n] !== "function_definition" && t.type[n] !== "method_declaration") continue;
            const name = textOf(t, child(t, n, "name")).toLowerCase();
            // Its PHPDoc, before it or after its attributes.
            const doc = [prevSibling(t, n), ...children(t, n)].filter((d) => d >= 0 && t.type[d] === "comment").map((d) => textOf(t, d)).join("\n");
            const params = namedChildren(t, child(t, n, "parameters")).map((x) => textOf(t, child(t, x, "name")).slice(1));
            // `@phpstan-this-out Foo`, `@phpstan-self-out Foo`: an assertion on `$this` after the call, but where it keeps the class (`static<T>`).
            for (const [, v = "this", rest = "", out] of doc.matchAll(/@(?:phpstan|psalm)-(?:assert\S*[^$\n]*\$(\w+)((?:->\w+(?:\(\))?)*)|(?:this|self)-out\s+([^\s<]+))/g)) if (!/^(\$this|static|self)$/i.test(out ?? "")) push(asserts, name, [v === "this" ? -1 : params.includes(v) ? params.indexOf(v) : -2, rest]);
            if (t.type[n] === "method_declaration" && /private/.test(modifiers(t, n))) privates.add(name);
            const ns = spaceAt(pf.o, t.start[n]).ns.toLowerCase();
            if (t.type[n] === "function_definition") push(fns, ns ? `${ns}\\${name}` : name, [pf, n] as [PFile, number]);
        }
        const uses = new Map<string, string>();
        for (const i of PHP_RULES.imports(t)) {
            let clause = i.node;
            while (t.type[clause] !== "namespace_use_clause") clause = t.parent[clause];
            const type = [child(t, clause, "type"), child(t, i.stmt, "type")].find((x) => x >= 0);
            if (type !== undefined && textOf(t, type).toLowerCase() === "function") uses.set(i.local.toLowerCase(), (i.spec ? `${i.spec}\\${i.name}` : i.name!).toLowerCase());
        }
        fnUses.set(pf, uses);
    }
    const atNode = (pf: PFile, n: number) => {
        const d = pf.o.byNode.get(n);
        return d && ofDecl.get(d);
    };

    /**
     * A class by its full name: the one its own file declares, else the one
     * Composer loads, the first file of the PSR-4 map that exists, when that
     * file declares it at its top and no other file read declares it. A file
     * the parser read with errors may hide a member or misplace a namespace.
     */
    const classByName = (from: PFile, fqn: string): PClass | null => {
        const all = declared.get(fqn.toLowerCase()) ?? [];
        const own = all.filter((c) => c.file === from);
        const sure = (cs: PClass[], g: PFile) => (cs.length === 1 && cs[0].file === g && cs[0].d.top && g.t.errors === 0 ? cs[0] : null);
        if (own.length > 0) return sure(own, from);
        for (const path of classFiles(composer, fqn)) {
            if (ctx.exists?.(path) === false) continue;
            const g = pfiles.get(path);
            if (g) return sure(all, g);
            miss?.(path);
            return null;
        }
        return null;
    };

    /** The code a node is in: its class, none, or "?" in a closure or a trait. */
    const scopeOf = (pf: PFile, n: number): Scope => {
        for (let x = pf.t.parent[n]; x >= 0; x = pf.t.parent[x]) {
            const ty = pf.t.type[x];
            if (ty === "anonymous_function" || ty === "arrow_function" || ty === "anonymous_class") return "?";
            if (ty === "function_definition") return null;
            const c = atNode(pf, x);
            if (c) return c.d.kind === "trait" ? "?" : c;
        }
        return null;
    };
    const selfAt = (pf: PFile, n: number): PClass | null => {
        const s = scopeOf(pf, n);
        return s === "?" ? null : s;
    };

    /** A class's parent: undefined when it has none, null when it isn't known. */
    const parentOf = (c: PClass): PClass | null | undefined => {
        if (c.d.parents.length === 0) return undefined;
        const p = classAt(c.file, c.d.parents[0]);
        return p?.d.kind === "class" ? p : null;
    };

    /** The class a name node names where it's written: `\A\B`, an alias a `use` before it brings, its namespace's; self, static and parent as the code it's in gives them. */
    const classAt = (pf: PFile, n: number): PClass | null => classNamed(pf, nameText(pf.t, n), n);

    /** The class a name names, written at a node. */
    const classNamed = (pf: PFile, text: string, n: number): PClass | null => {
        const word = text.toLowerCase();
        if (word === "self" || word === "static") return selfAt(pf, n);
        if (word === "parent") {
            const self = selfAt(pf, n);
            return (self && parentOf(self)) ?? null;
        }
        return classByName(pf, fullName(pf, text, n));
    };

    /** A class name's full name where it's written: `\A\B`, an alias a `use` before it brings, its namespace's. */
    const fullName = (pf: PFile, text: string, n: number): string => {
        if (text.startsWith("\\")) return text.slice(1);
        const space = spaceAt(pf.o, pf.t.start[n]);
        const [first, ...rest] = text.split("\\");
        const use = space.uses.find((u) => u.alias === first.toLowerCase() && u.at < pf.t.start[n]);
        return use ? [use.target, ...rest].join("\\") : space.ns ? `${space.ns}\\${text}` : text;
    };

    /** A member a class's traits give it, by a name no adaptation writes: one trait's concrete one, else an abstract one, which an inherited one beats. */
    const fromTraits = (c: PClass, own: (d: ClassDecl) => Member | null | undefined, key: string, depth: number): Look => {
        if (c.d.traits.length === 0) return "none";
        if (c.d.adapted.has(key) || depth > MAX_DEPTH) return null;
        const found: Found[] = [];
        for (const n of c.d.traits) {
            const tr = classAt(c.file, n);
            if (tr?.d.kind !== "trait") return null;
            const m = own(tr.d);
            const r = m === undefined ? fromTraits(tr, own, key, depth + 1) : m && { m, owner: tr, host: c };
            if (!r) return null;
            if (r !== "none") found.push({ ...r, host: c });
        }
        const concrete = found.filter((f) => !f.m.isAbstract);
        return concrete.length > 1 ? null : (concrete[0] ?? found[0] ?? "none");
    };

    /** A member through a class, its traits, then its parents: PHP's order, a trait's abstract method giving way to an inherited one. */
    const inClasses = (c: PClass, own: (d: ClassDecl) => Member | null | undefined, key: string, depth = 0): Look => {
        const m = own(c.d);
        if (m !== undefined || depth > MAX_DEPTH) return m ? { m, owner: c, host: c } : null;
        const t = fromTraits(c, own, key, depth);
        if (t === null || (t !== "none" && !t.m.isAbstract)) return t;
        const p = parentOf(c);
        const up = p === undefined ? "none" : p && inClasses(p, own, key, depth + 1);
        return up === "none" ? t : up;
    };

    /** The one member some lookups found, or "none"; null when one couldn't tell or two differ. */
    const oneOf = (looks: Look[]): Look => {
        if (looks.includes(null)) return null;
        const found = [...new Map((looks.filter((l) => l !== "none") as Found[]).map((l) => [l.m, l])).values()];
        return found.length > 1 ? null : (found[0] ?? "none");
    };

    /** A method through an interface: its own, else the one its parents declare. */
    const inInterface = (i: PClass | null, key: string, depth: number): Look => {
        if (i?.d.kind !== "interface" || depth > MAX_DEPTH) return null;
        const m = i.d.methods.get(key);
        return m !== undefined ? m && { m, owner: i, host: i } : oneOf(i.d.interfaces.map((n) => inInterface(classAt(i.file, n), key, depth + 1)));
    };

    /** A method of a class-like by lowercase name: through the classes, then every interface of the class and its parents; a trait's abstract method isn't known, nor an enum's `cases`, `from` and `tryFrom`, PHP's own whatever an interface declares. */
    const methodOf = (c: PClass, key: string): Found | null => {
        if (c.d.kind === "enum" && /^(cases|from|tryfrom)$/.test(key)) return null;
        let r: Look = c.d.kind === "interface" ? inInterface(c, key, 0) : inClasses(c, (d) => d.methods.get(key), key);
        if (r === "none" && c.d.kind !== "interface") {
            // The classes are all read: their interfaces, every one read, may declare it.
            const looks: Look[] = [];
            for (let k: PClass | null | undefined = c; k; k = parentOf(k)) looks.push(...k.d.interfaces.map((n) => inInterface(classAt(k!.file, n), key, 0)));
            r = oneOf(looks);
        }
        return r && r !== "none" && !(r.owner.d.kind === "trait" && r.m.isAbstract) ? r : null;
    };

    /** Whether code in a scope may reach a member: public; private in its own class; protected in its class or a descendant, every class between read. */
    const visible = (r: Found, scope: Scope): boolean => {
        if (r.m.vis === "public") return true;
        if (!scope || scope === "?") return false;
        if (scope === r.host) return true;
        for (let k = parentOf(scope), depth = 0; k && depth < MAX_DEPTH && r.m.vis === "protected"; k = parentOf(k), depth++) if (k === r.host) return true;
        return false;
    };

    /** Whether a class-like is another or below it, through its parents and interfaces. */
    const derives = (a: PClass, b: PClass, depth = 0): boolean =>
        a === b ||
        (depth < MAX_DEPTH &&
            [...a.d.parents, ...a.d.interfaces].some((n) => {
                const p = classAt(a.file, n);
                return !!p && derives(p, b, depth + 1);
            }));

    /** A class's own private method of a name, or one a trait gives it; "none" when it has none; null when that can't be told. */
    const privateOf = (c: PClass, key: string): Look => {
        const m = c.d.methods.get(key);
        const r = m !== undefined ? m && { m, owner: c, host: c } : fromTraits(c, (d) => d.methods.get(key), key, 0);
        return r && r !== "none" && r.m.vis !== "private" ? "none" : r;
    };

    /**
     * Whether `$x->m()` may run the calling class's private m instead of the
     * method found: PHP calls it for an object of a class below the caller
     * (`$leaf->key()` in Node runs Node's private key, whatever Leaf
     * declares), an interface's object maybe one. A closure, a trait or a
     * file's code may run as any class: a private method of the name in a
     * file read, or in a class above the receiver's, may be it.
     */
    const hides = (pf: PFile, call: number, receiver: PClass, key: string, r: Found): boolean => {
        const scope = scopeOf(pf, call);
        let fn = pf.t.parent[call];
        while (fn >= 0 && !FUNCTIONS.has(pf.t.type[fn])) fn = pf.t.parent[fn];
        if (scope === "?" || fn < 0) {
            for (let k = receiver.d.kind === "class" ? parentOf(receiver) : undefined, d = 0; k && d < MAX_DEPTH; k = parentOf(k), d++) if (privateOf(k, key) !== "none") return true;
            return privates.has(key);
        }
        const own = scope && privateOf(scope, key);
        if (!scope || own === "none" || own?.m === r.m) return false;
        if (receiver.d.kind === "interface") return true;
        for (let k: PClass | null | undefined = receiver, d = 0; k !== undefined; k = parentOf(k), d++) if (!k || k === scope || d > MAX_DEPTH) return true;
        return false;
    };

    /** The constructor `new C` runs: its own or an inherited `__construct`, the class itself when none has one; null when it can't be told or C can't be made. */
    const constructorOf = (c: PClass, scope: Scope): Found | PClass | null => {
        if (c.d.kind !== "class" || c.d.isAbstract) return null;
        const r = inClasses(c, (d) => d.methods.get("__construct"), "__construct");
        return r === "none" ? c : r && visible(r, scope) ? r : null;
    };

    /** A type a declaration writes: a class, `?Foo` or `Foo|null`; `self`, `static` and `parent` as the member's class and the receiver give them. */
    const typeName = (pf: PFile, n: number, self: PClass | null, statik: PClass | null): PClass | null => {
        const t = pf.t;
        const ty = t.type[n];
        if (ty === "optional_type") return typeName(pf, namedChildren(t, n)[0] ?? -1, self, statik);
        if (ty === "union_type") {
            const parts = namedChildren(t, n).filter((c) => textOf(t, c).toLowerCase() !== "null");
            return parts.length === 1 ? typeName(pf, parts[0], self, statik) : null;
        }
        const name = ty === "named_type" ? classNameNode(t, n) : -1;
        const word = nameText(t, name).toLowerCase();
        return name < 0 ? null : word === "self" ? self : word === "static" ? statik : word === "parent" ? ((self && parentOf(self)) ?? null) : classAt(pf, name);
    };

    /** An instance property's type, through the class, its traits and parents, where code in a scope may read it: declared and visible, `__get` never serves it. */
    const propertyOf = (c: PClass, name: string, scope: Scope): PClass | null => {
        const r = inClasses(c, (d) => d.props.get(name), `$${name}`);
        return !r || r === "none" || r.m.isStatic || !visible(r, scope) ? null : typeName(r.owner.file, r.m.node, r.host, null);
    };

    // Every value asked for at a node, once; a node asked for again while its value is being made gets null.
    const cache = new Map<string, unknown>();
    const cached = <V>(pf: PFile, n: number, kind: string, make: () => V | null): V | null => {
        const k = `${kind}${pf.f.path}#${n}`;
        if (cache.has(k)) return cache.get(k) as V | null;
        cache.set(k, null);
        const v = make();
        cache.set(k, v);
        return v;
    };

    /** The method a call reaches, with the class its lookup started from. */
    const callOf = (pf: PFile, call: number): { r: Found; receiver: PClass } | null =>
        cached(pf, call, "c", () => {
            const t = pf.t;
            const key = textOf(t, child(t, call, "name")).toLowerCase();
            const s = child(t, call, "scope");
            const object = child(t, call, "object");
            // A `::` scope names a class, self, static or parent; an expression's (`$x::m()`) text is no class name.
            const receiver = s >= 0 ? classAt(pf, s) : typeOf(pf, object);
            const r = receiver && methodOf(receiver, key);
            if (!r || !visible(r, scopeOf(pf, call)) || (s < 0 && (hides(pf, call, receiver, key, r) || assertedOn(t, object, asserts, call)))) return null;
            // Where the receiver's class is tested, each class tested (or the class of what it is compared with, where nothing else may narrow that) must reach the same method, or be the receiver's or above it.
            for (const [n, from] of s >= 0 ? [] : testsWith(t, object)) {
                const c = n === "?" ? null : classNameNode(t, n) >= 0 ? classAt(pf, n) : otherTests(t, n, from).length > 0 || assertedOn(t, n, asserts) ? null : typeOf(pf, n);
                if (!c || (methodOf(c, key)?.m !== r.m && !derives(receiver, c))) return null;
            }
            return { r, receiver: t.type[s] === "relative_scope" ? (selfAt(pf, call) ?? receiver!) : receiver! };
        });

    /** The classes an inline PHPDoc's `@var` tags name, `?Foo`, `Foo|null` and `Foo<…>` as Foo; null for any other type. */
    const docTypes = (pf: PFile, n: number): (PClass | null)[] =>
        [...textOf(pf.t, n).matchAll(VAR_TAG)].map(([, , type]) => {
            const name = type.replace(/^\?|\|null$|^null\||<.*$/gi, "");
            return /^\\?\w+(\\\w+)*$/.test(name) && !/^(self|static|parent)$/i.test(name) ? classNamed(pf, name, n) : null;
        });

    /** The class `new` makes: a named class, self, static or parent; an anonymous class's or an expression's text is no class name. */
    const createdAt = (pf: PFile, e: number): PClass | null => classAt(pf, namedChildren(pf.t, e)[0] ?? -1);

    /** The class an expression's value is an instance of, as native declarations prove it; null when they don't. */
    const typeOf = (pf: PFile, e: number): PClass | null =>
        cached(pf, e, "t", () => {
            const t = pf.t;
            const ty = t.type[e];
            const name = child(t, e, "name");
            if (ty === "parenthesized_expression") return typeOf(pf, namedChildren(t, e)[0] ?? -1);
            if (ty === "variable_name") return variableAt(pf, e, textOf(t, e).slice(1));
            if (ty === "object_creation_expression") return createdAt(pf, e);
            // A property or a call's result given before, or what it hangs off given (`ensure_item_sub($this)`), to a call that may assert its type unseen (a callee not read) is unknown, as a variable is; `$this` itself keeps its class.
            if (passesOf(t, e).some((c) => (t.end[c] <= t.start[e] || inLoop(t, -1, c, e)) && unread(pf, c))) return null;
            if (ty.endsWith("member_access_expression")) {
                const c = t.type[name] === "name" ? typeOf(pf, child(t, e, "object")) : null;
                return c && propertyOf(c, textOf(t, name), scopeOf(pf, e));
            }
            if (!CALLS.has(ty)) return null;
            // A call's result: its method's written return type; `static`, the object's class, isn't known where a test may narrow the receiver, or where `Base::m()` passes `$this` on.
            const c = callOf(pf, e);
            const s = child(t, e, "scope");
            return c && typeName(c.r.owner.file, child(c.r.owner.file.t, c.r.m.node, "return_type"), c.r.host, (s >= 0 ? t.type[s] !== "relative_scope" && !c.r.m.isStatic : testsOf(t, child(t, e, "object")).length > 0) ? null : c.receiver);
        });

    /**
     * A variable at a node: `$this` in a class's own method; the value of the
     * `$x = …` that runs right before, or of the one write its function
     * makes; a parameter no write runs before (by value, not variadic); what
     * a closure takes from the code around it.
     */
    const variableAt = (pf: PFile, n: number, name: string): PClass | null => {
        const t = pf.t;
        let fn = t.parent[n];
        while (fn >= 0 && !FUNCTIONS.has(t.type[fn])) fn = t.parent[fn];
        if (name === "this") return t.type[fn] === "method_declaration" && !modifiers(t, fn).includes("static") ? selfAt(pf, fn) : null;
        if (fn < 0) return null;
        const { dynamic, vars } = varsOf(t)(fn);
        const v = vars.get(name);
        const arrow = t.type[fn] === "arrow_function";
        if (dynamic || v?.aliased || v?.use === "ref") return null;
        // A call that may take it by reference may change it then, or later through a reference it keeps: reads after it, or in a loop with it, are unknown.
        if (v?.passed.some((a) => (after(t, a, n) || inLoop(t, fn, a, n)) && mayWrite(pf, a))) return null;
        // An arrow function reads what it doesn't bind from the code around it, as it was when the function was made.
        if (!v) return arrow ? variableAt(pf, fn, name) : null;
        const r = arrow ? (v.writes.length > 0 ? null : "start") : reachOf(t, fn, n, v);
        const p = v.param;
        if (r === "start") return p < 0 ? (v.use || arrow ? variableAt(pf, fn, name) : null) : t.type[p] === "variadic_parameter" || child(t, p, "reference_modifier") >= 0 ? null : typeName(pf, child(t, p, "type"), selfAt(pf, p), null);
        // A value whose class code tests may hold a narrower one there: PHP's checks narrow what it is assigned to too. One an inline `@var` types is what it names, where that's the class it has.
        const valueOf = (e: number) => {
            const c = testsOf(t, e).length > 0 || assertedOn(t, e, asserts) ? null : typeOf(pf, e);
            const doc = v!.doc.get(e);
            return doc === undefined || docTypes(pf, doc).every((d) => d === c) ? c : null;
        };
        if (r !== null) return valueOf(r);
        // One write in the whole function, which the read must come after for a call on it to work.
        const only = v.values.get(v.writes[0]);
        return v.writes.length === 1 && p < 0 && !v.use && only !== undefined ? valueOf(only) : null;
    };

    /** Whether a declaration takes the argument at a position (or of a name) by reference; past its parameters, a function or a constructor takes it nowhere, an override of a method may. */
    const byRefAt = ([g, decl]: [PFile, number], i: number, label: string, exact: boolean): boolean => {
        const ps = namedChildren(g.t, child(g.t, decl, "parameters"));
        const last = ps[ps.length - 1];
        const p = label ? ps.find((x) => textOf(g.t, child(g.t, x, "name")) === `$${label}`) : (ps[i] ?? (g.t.type[last] === "variadic_parameter" ? last : undefined));
        return g.t.errors > 0 || (p === undefined ? !exact || label !== "" : child(g.t, p, "reference_modifier") >= 0);
    };

    /**
     * The function a call names: the namespace's own where a file read
     * declares it, else the global one, a file's or PHP's own (its entry in
     * `BUILTINS`, by-reference positions); undefined for any other, a
     * callable value's or one no file read declares.
     */
    const functionOf = (pf: PFile, call: number): [PFile, number][] | string | undefined => {
        const t = pf.t;
        const f = child(t, call, "function");
        if (classNameNode(t, f) < 0) return undefined;
        const text = nameText(t, f).toLowerCase();
        const ns = spaceAt(pf.o, t.start[call]).ns.toLowerCase();
        const alias = fnUses.get(pf)!.get(text);
        const names = text.startsWith("\\") ? [text.slice(1)] : text.includes("\\") ? [ns ? `${ns}\\${text}` : text] : alias ? [alias] : ns ? [`${ns}\\${text}`, text] : [text];
        for (const name of names) if (fns.has(name)) return fns.get(name);
        // PHP's own function: a namespace's function of its name in a file not read is taken not to shadow it.
        return BUILTINS.get(names[names.length - 1]);
    };

    /** Whether a call not read is an assertion API every test suite calls: PHPUnit's by name, webmozart/assert's and beberlei/assert's by class. Each takes its arguments by value and narrows only as `narrowing.ts` reads. */
    const vendor = (pf: PFile, call: number): boolean => {
        const s = child(pf.t, call, "scope");
        return PHPUNIT.has(callName(pf.t, call)) || (s >= 0 && ASSERT_CLASSES.has(fullName(pf, nameText(pf.t, s), s).toLowerCase()));
    };

    /** Whether a call's callee may assert a type the files read don't show: a callable value, a method, function or constructor not found but an assertion API's. */
    const unread = (pf: PFile, call: number): boolean => {
        const ty = pf.t.type[call];
        const c = ty === "object_creation_expression" ? createdAt(pf, call) : null;
        const found = ty === "object_creation_expression" ? !!c && !!constructorOf(c, scopeOf(pf, call)) : CALLS.has(ty) ? !!callOf(pf, call) : functionOf(pf, call) !== undefined;
        return !found && !vendor(pf, call);
    };

    /**
     * Whether the call a variable is passed to whole may take it by reference:
     * a method, constructor or function found, by its parameter (PHP's own by
     * `BUILTINS`); an assertion API never; any other callee (`$f($x)`, a
     * method or function not read) may.
     */
    const mayWrite = (pf: PFile, n: number): boolean => {
        const t = pf.t;
        const arg = t.parent[n];
        const call = t.parent[t.parent[arg]];
        const ln = child(t, arg, "name");
        const label = ln < 0 ? "" : textOf(t, ln);
        const i = namedChildren(t, t.parent[arg]).indexOf(arg);
        if (t.type[call] === "object_creation_expression") {
            const c = createdAt(pf, call);
            const k = c && constructorOf(c, scopeOf(pf, call));
            return !k || ("m" in k && byRefAt([k.owner.file, k.m.node], i, label, true));
        }
        if (CALLS.has(t.type[call])) {
            const c = callOf(pf, call);
            return c ? byRefAt([c.r.owner.file, c.r.m.node], i, label, false) : !vendor(pf, call);
        }
        const f = functionOf(pf, call);
        if (f === undefined) return !vendor(pf, call);
        if (typeof f !== "string") return f.some((d) => byRefAt(d, i, label, true));
        return f !== "" && (label !== "" || f.split(",").some((r) => (r.endsWith("+") ? i >= parseInt(r) : i === Number(r))));
    };

    return { pfileOf: (f: GFile) => pfiles.get(f.path)!, classAt, classByName, scopeOf, callOf, createdAt, constructorOf };
};

export type Program = ReturnType<typeof createProgram>;

/** Whether a read comes after a variable's passing to a call, the call's own arguments aside: they run before it. */
const after = (t: GFile["flat"], a: number, n: number): boolean => t.start[a] < t.start[n] && t.start[n] >= t.end[t.parent[t.parent[t.parent[a]]]];

/** Whether a loop in a function holds both nodes: one may run after the other there. */
const inLoop = (t: GFile["flat"], fn: number, a: number, n: number): boolean => {
    for (let x = t.parent[a]; x >= 0 && x !== fn; x = t.parent[x]) if (LOOPS.test(t.type[x]) && t.start[x] <= t.start[n] && t.start[n] < t.end[x]) return true;
    return false;
};
