/**
 * Which declaration each name refers to, across the files a PR's board reads:
 * scopes inside a file, imports and re-exports between files, and members
 * through what a receiver is known to be (`resolve/evaluator.ts`).
 *
 * A file names another file's declaration only through an import. A member
 * (`x.y`) resolves when the receiver is known: `this`, `super`, a class or
 * namespace, a module, an object literal, or a local built with `new C()` or
 * typed `C`. Anything else resolves to nothing, and makes no link. A site
 * that may name either of two declarations (`(flag ? a : b).run()`) names
 * neither: a line needs exactly one.
 */

import { child, hasToken, type Flat } from "../../syntax.ts";
import type { Ref, Unit } from "../pack.ts";
import { scopeAt, type Binding, type ExportEntry, type FileFacts, type Site } from "./facts.ts";
import { requireSpec } from "./facts/modules.ts";
import { propName, unwrap } from "./facts/nodes.ts";
import { lookup, NS, TYPE, VALUE } from "./facts/scopes.ts";
import { createEvaluator, importOf, positional, type Access, type Evaluator } from "./resolve/evaluator.ts";
import type { PathMapping } from "./resolve/paths.ts";
import { namespace, unknown, type Val } from "./resolve/values.ts";

export { builtinRule } from "./resolve/builtins.ts";

/** Svelte's runes, which read like stores: `$state(0)`, `$effect.pre(...)`. */
const RUNES = new Set(["$state", "$derived", "$props", "$bindable", "$effect", "$inspect", "$host"]);
/** Vue's compiler macros: the compiler takes their calls, whatever a name they share is bound to. */
const MACROS = new Set(["defineProps", "defineEmits", "defineExpose", "defineOptions", "defineSlots", "defineModel", "withDefaults"]);

export type LinkerConfig = {
    /** tsconfig `paths` that apply to a file, targets already joined to `baseUrl` and made repo-relative. */
    paths: (from: string) => readonly PathMapping[];
    /** The file a bare import stands for in this repository (`builtinRule`), or null. */
    builtin: (spec: string) => string | null;
    /** The first of an import's candidates the read tier found, null when none was there; undefined when it didn't follow the import. */
    answered?: (from: string, spec: string) => string | null | undefined;
    /** Whether a path is there, as far as the reads went: undefined when never asked. Without it, every file read stands for the repository. */
    exists?: (path: string) => boolean | undefined;
};

/**
 * Every reference that names a declaration, in the files that can hold a
 * card: the changed files and those that import one. The other files lend
 * their declarations.
 */
export const resolveAll = (files: readonly FileFacts[], changed: ReadonlySet<string>, config: LinkerConfig): Ref[] => {
    const evaluator = createEvaluator(files, config);
    const resolveSite = siteResolver(evaluator);
    const holdsCards = (f: FileFacts) => changed.has(f.path) || f.specifiers.some((spec) => changed.has(evaluator.resolveModule(f.path, spec).path ?? ""));
    const refs: Ref[] = [];
    for (const f of files.filter(holdsCards)) {
        for (const s of f.sites) {
            const units = resolveSite(f, s);
            if (units.length > 0) refs.push({ path: f.path, start: s.start, line: s.line, ref: s.ref, units });
        }
    }
    return refs;
};

/** Declarations a site names when it is known to name exactly one; none when it may name either of two. */
const one = (units: Unit[]): Unit[] => (units.length > 1 ? [] : units);

/** Whether a member expression is assigned through a destructuring pattern (`[a.x] = v`, `({ k: a.x = 1 } = v)`) or a `for` head (`for (a.x of v)`). */
const patternTarget = (t: Flat, e: number): boolean => {
    let c = e;
    for (let p = t.parent[c]; p >= 0; c = p, p = t.parent[p]) {
        const type = t.type[p];
        if (type === "array_pattern" || type === "object_pattern" || type === "rest_pattern" || (type === "pair_pattern" && t.field[c] === "value") || (type === "assignment_pattern" && t.field[c] === "left")) continue;
        return (type === "assignment_expression" && t.field[c] === "left" && c !== e) || (type === "for_in_statement" && t.field[c] === "left");
    }
    return false;
};

/** How a member site uses the member: `x.a = v` and destructuring into it write it; `x.a += v` and `x.a++` read and write it; `delete x.a` neither. */
const accessOf = (t: Flat, s: Site): Access => {
    let e = t.parent[s.node];
    while (t.type[t.parent[e]] === "parenthesized_expression" || t.type[t.parent[e]] === "non_null_expression") e = t.parent[e];
    const p = t.parent[e];
    if (t.type[p] === "update_expression" || (t.type[p] === "augmented_assignment_expression" && child(t, p, "left") === e)) return "update";
    if (t.type[p] === "unary_expression" && hasToken(t, p, "delete")) return "delete";
    return s.ref === "write" || patternTarget(t, e) ? "write" : "read";
};

/** The declarations one site names; none when it names a local, a key, a global, a package or a member of anything unknown. */
const siteResolver = ({ byPath, resolveModule, importVal, moduleVal, exportVal, bindingVal, evalExpr, receiverVal, memberOf }: Evaluator) => {
    const resolveSite = (f: FileFacts, s: Site): Unit[] => {
        if (s.importEntry) return s.importEntry.imported === "*" ? [] : one(importVal(f, s.importEntry).units);
        if (s.keyPath) return one(requiredUnits(f, s.node, s.keyPath));
        if (s.exportEntry) return one(exportedUnits(f, s.exportEntry));
        return s.form === "bare" ? bareUnits(f, s) : one(memberUnits(f, s));
    };

    /** A key `const { a: { b } } = require('m')` takes: m's member along the key path. */
    const requiredUnits = (f: FileFacts, node: number, keyPath: readonly string[]): Unit[] => {
        const t = f.flat;
        let a = node;
        while (a >= 0 && t.type[a] !== "variable_declarator") a = t.parent[a];
        let v = a >= 0 ? evalExpr(f, child(t, a, "value")) : unknown("require");
        for (const key of keyPath) {
            if (positional(key)) return [];
            v = step(v, key);
        }
        return v.units;
    };

    /** An export's name: the local declaration it exports, or what a re-export names. */
    const exportedUnits = (f: FileFacts, e: ExportEntry): Unit[] => {
        if (e.kind === "local") {
            const b = lookup(f.module, e.local, VALUE | TYPE | NS);
            if (!b) return [];
            if (b.unit) return [b.unit];
            return b.kind === "import" ? bindingVal(f, b).units : [];
        }
        if (e.kind !== "reexport") return [];
        const target = resolveModule(f.path, e.spec);
        return target.path ? (exportVal(target.path, e.imported, new Set())?.units ?? []) : [];
    };

    const bareUnits = (f: FileFacts, s: Site): Unit[] => {
        // A component's compiler macros and runes draw nothing.
        if (f.component && (f.component.framework === "vue" ? MACROS : RUNES).has(s.name)) return [];
        const b = lookup(s.scope, s.name, f.flat.type[s.node] === "type_identifier" ? TYPE : VALUE | NS);
        return b ? bindingUnits(f, b) : storeUnits(f, s);
    };
    const bindingUnits = (f: FileFacts, b: Binding): Unit[] => {
        if (b.kind === "import") {
            // A namespace import or whole-module require names no declaration itself.
            const entry = importOf(f, b);
            return entry && (entry.imported === "*" || entry.imported === "=") ? [] : one(bindingVal(f, b).units);
        }
        // `const X = require('m')` (or a member of it) is an alias, as TypeScript reads JavaScript: X names what it holds, when that is
        // one declaration read; the declaration itself when it holds nothing read; nothing when it may hold either of two.
        if (!b.unit) return [];
        const held = requireAlias(f, b);
        return held.length === 0 ? [b.unit] : one(held);
    };
    /**
     * In a Svelte component's instance script, `$name` reads the store
     * `name` its top level declares or imports, as Svelte subscribes to it;
     * not where a nearer `name` hides it, not in its module script, and
     * never a rune (`$state`).
     */
    const storeUnits = (f: FileFacts, s: Site): Unit[] => {
        const c = f.component;
        if (c?.framework !== "svelte" || !c.inner || f.flat.type[s.node] !== "identifier" || !/^\$[A-Za-z_]/.test(s.name)) return [];
        if (!c.blocks.some((b) => b.inner && b.start <= s.start && s.start < b.end)) return [];
        const name = s.name.slice(1);
        const store = lookup(c.inner, name, VALUE);
        return store && store === lookup(s.scope, name, VALUE) ? bindingUnits(f, store) : [];
    };

    const memberUnits = (f: FileFacts, s: Site): Unit[] => {
        const t = f.flat;
        // `A.B` in a type is a namespace's member.
        const receiver = t.type[t.parent[s.node]] === "nested_type_identifier" ? evalExpr(f, s.receiver) : receiverVal(f, s.receiver);
        const hit = memberOf(receiver, s.name, accessOf(t, s));
        return hit.found === "yes" ? hit.units : [];
    };

    /** For `const X = require('m')` or `const X = require('m').a.b`: the declarations X holds. */
    const requireAlias = (f: FileFacts, b: Binding): Unit[] => {
        const t = f.flat;
        if (b.init < 0 || b.path) return [];
        const keys: string[] = [];
        let e = unwrap(t, b.init);
        while (t.type[e] === "member_expression") {
            keys.unshift(propName(t, child(t, e, "property")));
            e = unwrap(t, child(t, e, "object"));
        }
        const spec = requireSpec(t, e, scopeAt(f, e));
        const m = spec === null ? undefined : byPath.get(resolveModule(f.path, spec).path ?? "");
        if (!m) return [];
        // Its whole value: module.exports, else the default export, else the namespace. A member path starts from what require() returns.
        let v = keys.length > 0 ? moduleVal(m.path) : m.moduleExports >= 0 ? evalExpr(m, m.moduleExports) : (exportVal(m.path, "default", new Set()) ?? namespace(m.path));
        for (const k of keys) v = step(v, k);
        return v.units.filter((u) => u !== b.unit);
    };

    /** One step along a key path: the member's value, naming what the member names. */
    const step = (v: Val, key: string): Val => {
        const hit = memberOf(v, key);
        return hit.units.length > 0 ? { ...hit.next, units: hit.units } : hit.next;
    };

    return resolveSite;
};
