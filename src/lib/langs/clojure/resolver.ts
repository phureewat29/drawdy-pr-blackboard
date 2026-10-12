/**
 * Clojure's resolver: which var a symbol names, as the compiler resolves it
 * (a local first; a namespace's own vars, its referred ones, then
 * clojure.core's; `alias/f` through the `ns` form). A name links only to
 * the one def form the files read prove, and in a `.cljc` file only when
 * every platform reading the site agrees.
 *
 * Nothing is linked for: a protocol's methods (the call's implementation
 * depends on its receiver), a multimethod's methods (dispatch), a name a
 * macro of unknown meaning may bind or define, `resolve`d or quoted names,
 * Java and JavaScript interop, a namespace whose file the reads can't
 * prove is the one its build loads, and a name any file read may change
 * as it loads (`effects.ts`): a `require`, `load` or `alias` outside the
 * `ns` form, its own or a wrapper's it calls, an `intern`, an
 * `alter-meta!` that may make a macro.
 */

import type { GFile, GSite } from "../../anyfacts.ts";
import type { ModuleContext, Named, OwnResolver } from "../../anylink.ts";
import type { Unit } from "../pack.ts";
import { CORE_MACROS, CORE_NS, DEFINES, SPECIAL, type Shape } from "./core.ts";
import { ALIASES, EVALS, LOADS, MACROS, REFERS, UNALIASES } from "./effects.ts";
import { CLJ, extensionsOf, nameNode, nsPath, platformsOf, rootOf, rootsFrom, type Platform, type Sym } from "./forms.ts";
import { coreName, targetOf } from "./ns.ts";
import { libraryOf, readOutline, type Def, type Outline } from "./outline.ts";
import { walkUses, type Use, type Uses } from "./walk.ts";

/** A cache by key. */
const cached = <V>(make: (key: string) => V) => {
    const m = new Map<string, V>();
    return (key: string): V => (m.has(key) ? m.get(key)! : (m.set(key, make(key)), m.get(key)!));
};

/** One value per file and platform. */
const perPlatform = <V>(make: (f: GFile, p: Platform) => V) => {
    const m = new Map<string, V>();
    return (f: GFile, p: Platform): V => {
        const key = `${f.path}\n${p.key}`;
        if (!m.has(key)) m.set(key, make(f, p));
        return m.get(key)!;
    };
};

/** The resolver over one review's Clojure files: what each site names, and the steps it takes to get there. */
export const createResolver = (files: readonly GFile[], ctx: ModuleContext) => {
    const byPath = new Map(files.map((f) => [f.path, f]));
    const exists = (path: string): boolean | undefined => (byPath.has(path) ? true : ctx.exists?.(path));
    const platformsByPath = cached((path) => platformsOf(path, byPath.get(path)!.flat));
    const platforms = (f: GFile) => platformsByPath(f.path);
    /**
     * Which names a file's code reads as code, for its effects: a quiet
     * walk (no effect, no other file) tells a local, a binding or data
     * from a `require`; undefined when no name in code may have one.
     */
    const keeps = perPlatform((f, p): ((n: number) => boolean) | undefined => {
        const quiet = readOutline(f, p, { quiet: true });
        if (!quiet.fx.code) return undefined;
        const uses = walkUses(f.flat, p, quiet, classifyIn(f, p, quiet, false));
        return (n) => uses.get(nameNode(f.flat, n)) !== null;
    });
    /** Each file's outline with its own effects only, as its forms show them. */
    const base = perPlatform((f, p) => readOutline(f, p, { keep: keeps(f, p) }));
    const roots = cached((path) => {
        const ns = base(byPath.get(path)!, platforms(byPath.get(path)!)[0]).ns?.name;
        return ns === undefined ? null : rootOf(path, ns);
    });

    /**
     * The file a platform loads a namespace from, seen from `from`'s roots:
     * the one root holding it, at the first extension the platform tries;
     * "missing" when no root holds it; null when the reads can't tell.
     */
    const fileOf = (ns: string, p: Platform, from: GFile): GFile | "missing" | null => {
        const root = roots(from.path);
        if (root === null) return null;
        let found: string | null = null;
        for (const r of rootsFrom(root))
            for (const ext of extensionsOf(p)) {
                const path = `${r}${nsPath(ns)}.${ext}`;
                const there = exists(path);
                if (there === undefined || (there && found !== null)) return null;
                if (!there) continue;
                found = path;
                break;
            }
        return found === null ? "missing" : (byPath.get(found) ?? null);
    };

    /** A namespace's defs of a name, as a platform reads its file; null when the file names another namespace or may hold more. */
    const defsIn = (g: GFile, ns: string, name: string, p: Platform): Def[] | null => {
        const o = outline(g, p);
        return o.ns?.name !== ns || o.open || o.maybe.has(name) ? null : (o.defs.get(name) ?? []);
    };

    /**
     * The one def a namespace gives a name for a platform, or null. In
     * ClojureScript a namespace's macros come from its Clojure file, when
     * the code asks for them or the namespace requires its own; a `.cljc`
     * file's `:cljs` branch may define one for self-hosted ClojureScript too.
     */
    const varDef = (ns: string, name: string, p: Platform, from: GFile): Def | null => {
        if (CORE_NS.has(ns) || libraryOf(ns)) return null;
        const g = fileOf(ns, p, from);
        let defs = g === "missing" ? [] : g && defsIn(g, ns, name, p);
        if (!defs) return null;
        if (p.host === "cljs" && (outline(from, p).ns?.macros.has(ns) || g === "missing" || outline(g!, p).ns?.macros.has(ns))) {
            const c = fileOf(ns, CLJ, from);
            if (c === null) return null;
            for (const q of c === "missing" ? [] : c.path.endsWith(".cljc") ? [CLJ, p] : [CLJ]) {
                const macros = defsIn(c as GFile, ns, name, q);
                if (!macros) return null;
                defs = [...defs, ...macros.filter((d) => d.kind === "macro")];
            }
        } else if (g === "missing") return null;
        // One form read on two platforms is one def; a record's or type's class is no var another namespace reaches.
        return new Set(defs.map((d) => d.unit ?? d)).size === 1 && defs[0].kind !== "class" ? defs[0] : null;
    };

    /**
     * The file's own def a name means in top-level form `top`, at `at`:
     * defined in an earlier form, in that one before `at` (or in the def
     * itself), or declared before it ("strict": earlier forms only, as a
     * syntax quote reads it). Undefined when the namespace defines no such
     * name; null when it does but no one def is proven.
     */
    const ownDef = (o: Outline, name: string, top: number, at: number, strict: boolean): Def | null | undefined => {
        const defs = o.defs.get(name);
        const declared = o.declared.get(name) ?? Infinity;
        if (!defs) return undefined;
        const d = defs[0];
        return defs.length === 1 && !o.maybe.has(name) && (d.top < top || (!strict && ((d.top === top && d.start <= at) || declared < top))) ? d : null;
    };

    /** The name a namespace referred whole (`:refer :all`, `:use`) gives a var under here: a renamed var goes by its new name only; null for none. */
    const original = (ra: NonNullable<Outline["ns"]>["referAll"][number], name: string): string | null => {
        const from = [...ra.rename].find(([, to]) => to === name)?.[0] ?? (ra.rename.has(name) ? null : name);
        return from === null || ra.exclude.has(from) ? null : from;
    };

    /**
     * Another namespace's var as a platform's code may name it: Clojure
     * refuses a private one but through `#'`, or inside a macro the code
     * names, which may take the name as a var's (ClojureScript only warns).
     * A head no file read proves a function's reads as one, so
     * `(t2/select :m (db/secret))` keeps its line to the private
     * `db/secret`: were `t2/select` a function, the code wouldn't compile,
     * and the line still goes to the var the name means.
     */
    const visible = (d: Def | null, p: Platform, byVar: boolean): Def | null => (d && (!d.private || byVar || p.host === "cljs") ? d : null);

    /** The namespaces and names a symbol may mean in a file: through an alias or a whole name, its own def, a refer, a namespace referred whole; `*` in a file of no namespace. */
    const meant = (o: Outline, s: Sym): [string, string][] => {
        if (s.ns !== null) return [[o.ns?.aliases.get(s.ns) ?? s.ns, s.name]];
        if (!o.ns) return [["*", s.name]];
        if (o.defs.has(s.name)) return [[o.ns.name, s.name]];
        const r = o.ns.refers.get(s.name);
        if (r) return [[r.ns, r.name]];
        return o.ns.referAll.flatMap((ra): [string, string][] => {
            const name = original(ra, s.name);
            return name === null ? [] : [[ra.ns, name]];
        });
    };

    let bodyIndex: Map<string, [GFile, number][]> | null = null;
    /** The top-level forms that run when a multimethod (`ns/name`) or a protocol's method (`name`) is called, in the files read: its `defmethod`s, the implementations. */
    const bodiesOf = (key: string): [GFile, number][] => {
        if (!bodyIndex) {
            bodyIndex = new Map();
            const add = (k: string, v: [GFile, number]) => bodyIndex!.set(k, [...(bodyIndex!.get(k) ?? []), v]);
            for (const f of files)
                for (const p of platforms(f)) {
                    const o = base(f, p);
                    for (const m of o.fx.methods) for (const [ns, name] of meant(o, m)) add(`${p.key}\n${ns}/${name}`, [f, m.top]);
                    for (const m of o.fx.impls) add(`${p.key}\n${m.name}`, [f, m.top]);
                }
        }
        return bodyIndex.get(key) ?? [];
    };

    // A var's effects (`effects.ts`) are its def forms' and those of the vars they name, through the files read: the least fixpoint, found in rounds. A macro's, or code building code of names (`eval`), adds the trigger names it and the vars it names mention.
    const settled = new Map<string, number>();
    const current = new Map<string, number>();
    const seen = new Map<string, number>();
    let round = 0;
    let grew = false;
    const fixed = (key: string, compute: (known: number) => number): number => {
        if (settled.has(key)) return settled.get(key)!;
        const known = current.get(key) ?? 0;
        if (seen.get(key) === round) return known;
        seen.set(key, round);
        const k = compute(known);
        grew ||= k !== known;
        current.set(key, k);
        return k;
    };
    /** The top-level forms that run when a var is called: its def forms, a multimethod's methods, a protocol method's implementations. */
    const runs = (g: GFile, name: string, p: Platform): [GFile, number][] => {
        const o = base(g, p);
        return (o.defs.get(name) ?? []).flatMap((d): [GFile, number][] => [
            [g, d.top],
            ...(d.kind === "multi" || d.guess === "multi" ? bodiesOf(`${p.key}\n${o.ns?.name ?? "*"}/${name}`) : []),
            ...(d.kind === "method" ? bodiesOf(`${p.key}\n${name}`) : []),
        ]);
    };
    const varEffects = (g: GFile, name: string, p: Platform): number =>
        fixed(`${g.path}\n${p.key}\n${name}`, (known) => runs(g, name, p).reduce((k, [h, top]) => k | (base(h, p).fx.call[top] & ~EVALS) | namedEffects(h, p, top, false) | built(h, p, top, made(g, p, name)), known));
    /**
     * What a top-level form may build code of: a macro (or a var a meta write
     * makes one), the names it and its helpers mention; code that `eval`s or
     * `resolve`s names, those it mentions itself. Code it reads from text
     * itself (`read-string`) may hold any; a helper's is no code it builds,
     * or every helper parsing text would count.
     */
    const built = (g: GFile, p: Platform, top: number, macro: boolean): number => {
        const b = base(g, p).fx.builds[top];
        return b & 2 || macro ? mentions(g, p, top) | read(b) : b & 1 ? base(g, p).fx.mention[top] | read(b) : 0;
    };
    const read = (builds: number) => (builds & 4 ? REFERS | ALIASES | LOADS : 0);
    let madeKeys: Set<string> | null = null;
    /** Whether a meta write in the files read names the var as one it makes a macro (`(alter-meta! #'m assoc :macro true)`, `(.setMacro (ns-resolve 'app.m n))`). */
    const made = (g: GFile, p: Platform, name: string): boolean => {
        if (!madeKeys) {
            madeKeys = new Set();
            for (const f of files) for (const q of platforms(f)) for (const s of base(f, q).fx.macroVars) for (const [ns, n] of meant(base(f, q), s)) madeKeys.add(`${ns}/${n}`);
        }
        const own = base(g, p).ns?.name ?? "*";
        return madeKeys.has(`${own}/${name}`) || madeKeys.has(`*/${name}`) || madeKeys.has(`${own}/*`);
    };
    /** The trigger names a top-level form, and the vars it names, mention, quoted ones too. */
    const mentions = (g: GFile, p: Platform, top: number): number => {
        const o = base(g, p);
        let k = o.fx.mention[top];
        for (const s of o.fx.names[top])
            for (const [ns, name] of meant(o, s)) {
                const h = ns === "*" || ns === o.ns?.name ? g : CORE_NS.has(ns) || libraryOf(ns) ? null : fileOf(ns, p, g);
                if (h && h !== "missing") k |= fixed(`m\n${h.path}\n${p.key}\n${name}`, (known) => runs(h, name, p).reduce((m, [i, t]) => m | mentions(i, p, t), known));
            }
        return k;
    };
    /**
     * The effects of the vars a top-level form names: all of them (a var's
     * body), or (`loading`) those that run as the file loads, and macros,
     * which expand into its code; a function its bodies call runs later,
     * in another namespace.
     */
    const namedEffects = (g: GFile, p: Platform, top: number, loading: boolean): number => {
        const o = base(g, p);
        let k = 0;
        for (const s of o.fx.names[top])
            for (const [ns, name] of meant(o, s)) {
                const h = ns === "*" || ns === o.ns?.name ? g : CORE_NS.has(ns) || libraryOf(ns) ? null : fileOf(ns, p, g);
                if (h && h !== "missing" && (!loading || s.now || base(h, p).defs.get(name)?.some((d) => d.kind === "macro" && !d.guess) || made(h, p, name))) k |= varEffects(h, name, p);
            }
        return k;
    };
    /** A query run to its fixpoint, after which every var it reached is settled. */
    const settle = (query: () => number): number => {
        let k = 0;
        do {
            grew = false;
            round++;
            k = query();
        } while (grew);
        for (const [key, v] of current) settled.set(key, v);
        current.clear();
        return k;
    };

    let internKeys: Set<string> | null = null;
    /** The vars a file read may `intern` into another namespace, as `ns/name` (`*` for any). */
    const interned = (): Set<string> => {
        if (internKeys) return internKeys;
        const keys = new Set<string>();
        for (const f of files) for (const p of platforms(f)) base(f, p).fx.interns.forEach((s) => keys.add(`${s.ns}/${s.name}`));
        return (internKeys = keys);
    };

    let macroKeys: Set<string> | null = null;
    /** The vars a file read may make macros (`alter-meta!`, `.setMacro`), as `ns/name` (`ns/*` for any of a namespace); through a wrapper or a var the meta write can't name, those the top-level form names, finds by name or takes from a namespace. */
    const macroVars = (): Set<string> => {
        if (macroKeys) return macroKeys;
        const keys = new Set<string>();
        for (const f of files)
            for (const p of platforms(f)) {
                const o = base(f, p);
                const add = (s: Sym) => meant(o, s).forEach(([ns, name]) => keys.add(`${ns}/${name}`));
                o.fx.macroVars.forEach(add);
                o.fx.vars.forEach((vs, top) => vs.length && (o.fx.call[top] | settle(() => namedEffects(f, p, top, false))) & MACROS && vs.forEach(add));
            }
        return (macroKeys = keys);
    };

    /**
     * A file's outline as the files read show it: with the effects of the
     * vars its code names (a wrapper's `require` or `load`), and the vars
     * a file's `alter-meta!` makes macros.
     */
    const outline = perPlatform((f, p): Outline => {
        const b = base(f, p);
        const bits = b.fx.bits.reduce((a, x) => a | x, 0);
        // A form building code of names here (`eval`, `resolve`) runs as the file loads, or is the file's own.
        const extra = settle(() => b.fx.names.reduce((k, _, top) => k | namedEffects(f, p, top, true) | (b.fx.builds[top] & 1 ? b.fx.mention[top] | read(b.fx.builds[top]) : 0), 0)) & (REFERS | LOADS | ALIASES | UNALIASES);
        const o = extra & ~bits ? readOutline(f, p, { keep: keeps(f, p), extra }) : b;
        // A file with a parse error proves nothing; another file's `intern` may define any var of the namespace, or one name.
        const own = o.ns?.name ?? "*";
        const interns = interned();
        o.open ||= f.flat.errors > 0 || interns.has(`${own}/*`);
        for (const name of o.defs.keys()) if (interns.has(`${own}/${name}`) || interns.has(`*/${name}`)) o.maybe.add(name);
        const keys = macroVars();
        for (const [name, ds] of o.defs)
            if (keys.has(`${own}/${name}`) || keys.has(`*/${name}`) || keys.has(`${own}/*`))
                for (const d of ds)
                    if (d.kind === "fn" || d.kind === "value" || d.kind === "multi" || d.guess) {
                        d.kind = "macro";
                        delete d.guess;
                    }
        return o;
    });

    /** The var a use names, as its platform reads it, or null. */
    const resolveUse = (f: GFile, p: Platform, u: Use): Def | null => {
        const o = outline(f, p);
        if (o.open) return null;
        if (u.mode === "refer") return visible(varDef(u.ns!, u.name, p, f), p, false);
        if (u.mode === "class") {
            const d = ownDef(o, u.name, u.top, u.at, false);
            return d?.kind === "class" ? d : null;
        }
        if (u.ns !== null) {
            // An alias added outside the `ns` form may name a namespace's whole name another.
            if (o.unaliased || (o.aliased && !o.ns?.aliases.has(u.ns))) return null;
            if (u.ns === o.ns?.name) return ownDef(o, u.name, u.top, u.at, u.mode === "syntax") ?? null;
            // A namespace by its whole name only where the `ns` form requires it, so that it's loaded.
            const target = o.ns?.aliases.get(u.ns) ?? (o.ns?.requires.includes(u.ns) ? u.ns : null);
            return target === null ? null : visible(varDef(target, u.name, p, f), p, u.mode === "var" || (u.shown && u.mode === "code"));
        }
        if (u.hidden && u.mode === "code") return null;
        const own = ownDef(o, u.name, u.top, u.at, u.mode === "syntax");
        const r = o.ns?.refers.get(u.name);
        if (own !== undefined) return r ? null : own;
        if (o.maybe.has(u.name)) return null;
        if (r) return visible(varDef(r.ns, r.name, p, f), p, false);
        // Valid code refers each name from one namespace only, and never a private var.
        const found = (o.ns?.referAll ?? []).flatMap((ra) => {
            const name = original(ra, u.name);
            const d = name === null || CORE_NS.has(ra.ns) || libraryOf(ra.ns) ? null : varDef(ra.ns, name, p, f);
            return d && !d.private ? [d] : [];
        });
        return found.length === 1 ? found[0] : null;
    };

    /** The form a var of a namespace gives a list it heads; `cross` false reads no other file. */
    const headIn = (ns: string, name: string, p: Platform, from: GFile, cross: boolean): Shape => {
        if (CORE_NS.has(ns)) return SPECIAL.get(name) ?? CORE_MACROS.get(name) ?? "call";
        const lib = libraryOf(ns)?.get(name);
        if (libraryOf(ns)) return lib === "unknown" ? "macro" : (lib ?? "call");
        if (DEFINES.has(name)) return name === "def" ? "unknown" : DEFINES.get(name)![1];
        if (!cross) return "unknown";
        // A var no file read proves a function's may be a macro the code shows by name.
        const d = varDef(ns, name, p, from);
        return d && !visible(d, p, false) ? "unknown" : d && d.kind !== "macro" ? "call" : d?.guess ? "unknown" : "macro";
    };

    /** What a list's head does with its forms, in a file for a platform, as an outline reads it: a form of the tables, a function's call, a macro or unknown; `cross` false reads no other file. */
    const classifyIn = (f: GFile, p: Platform, o: Outline, cross: boolean) => {
        const ns = o.ns;
        const own = (name: string, top: number, at: number): Shape => {
            const d = ownDef(o, name, top, at, false);
            return !d || d.guess ? "unknown" : d.kind !== "macro" ? "call" : "macro";
        };
        return (s: Sym, top: number, at: number): Shape => {
            if (s.ns !== null) {
                if (o.unaliased || (o.aliased && !ns?.aliases.has(s.ns))) return "unknown";
                if (s.ns === ns?.name) return own(s.name, top, at);
                const target = targetOf(ns, s.ns);
                const whole = target === s.ns && !CORE_NS.has(target) && !libraryOf(target);
                // `Math/abs`, `js/console.log`: interop, whose arguments are code.
                if (whole && !DEFINES.has(s.name) && (target === "js" || /^[A-Z]/.test(target.slice(target.lastIndexOf(".") + 1)))) return "call";
                return target === "" || (whole && !ns?.requires.includes(target)) ? "unknown" : headIn(target, s.name, p, f, cross);
            }
            const shape = SPECIAL.get(s.name) ?? DEFINES.get(s.name)?.[1];
            if (shape) return shape;
            // A `comment` form never runs, whatever else the file may refer, but one of its own.
            if (s.name === "comment" && !o.defs.has(s.name) && !ns?.refers.has(s.name)) return "comment";
            if (o.open || o.maybe.has(s.name)) return "unknown";
            if (o.defs.has(s.name)) return own(s.name, top, at);
            const r = ns?.refers.get(s.name);
            if (r) return r.macro ? "macro" : headIn(r.ns, r.name, p, f, cross);
            // Referred whole: a library's macro, or the var a namespace read defines; one not read may hold any macro.
            for (const ra of ns?.referAll ?? []) {
                const name = original(ra, s.name);
                const lib = CORE_NS.has(ra.ns) ? CORE_MACROS : libraryOf(ra.ns);
                if (name === null) continue;
                if (lib?.has(name)) return lib.get(name) === "unknown" ? "macro" : lib.get(name)!;
                const g = lib || !cross ? null : fileOf(ra.ns, p, f);
                const defs = g && g !== "missing" ? defsIn(g, ra.ns, name, p) : lib ? [] : null;
                const pub = defs?.filter((d) => !d.private);
                if (!pub) return "unknown";
                if (pub.length > 0) return pub.length !== 1 || pub[0].guess ? "unknown" : pub[0].kind !== "macro" ? "call" : "macro";
            }
            const core = coreName(ns, s.name);
            return o.openRefers || core === null ? "unknown" : (CORE_MACROS.get(core) ?? "call");
        };
    };

    const usesOf = perPlatform((f, p): Uses => walkUses(f.flat, p, outline(f, p), classifyIn(f, p, outline(f, p), true)));

    // A site may reach only a var some file defines (a class `Foo` by `Foo.` too), or one a file refers under another name.
    const names = new Set(
        files.flatMap((f) =>
            platforms(f).flatMap((p) => {
                const o = outline(f, p);
                return [...o.defs.keys(), ...(o.ns?.refers.keys() ?? []), ...(o.ns?.referAll ?? []).flatMap((ra) => [...ra.rename.values()])];
            })
        )
    );

    const site = (f: GFile, s: GSite): Named => {
        if (!names.has(s.name) && !names.has(s.name.slice(0, -1))) return [];
        let target: Unit | null = null;
        let how: Use["how"] = "value";
        for (const p of platforms(f)) {
            const u = usesOf(f, p).get(s.node);
            if (u === undefined) continue;
            const d = u && resolveUse(f, p, u);
            const unit = d && d.kind !== "method" ? d.unit : undefined;
            if (!unit || (target && target !== unit)) return [];
            target = unit;
            how = u!.how;
        }
        return target ? [{ ref: how, units: [target] }] : [];
    };
    return { site, platforms, outline, base, usesOf, resolveUse };
};

export const CLOJURE_RESOLVER: OwnResolver = { program: (files, ctx) => createResolver(files, ctx).site };
