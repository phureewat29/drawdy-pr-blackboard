/**
 * Which declaration each name refers to, across the files a PR's board reads:
 * scopes inside a file, imports and re-exports between files, and members
 * through what a receiver is known to be (`linker/evaluator.ts`).
 *
 * A file names another file's declaration only through an import. A member
 * (`x.y`) resolves when the receiver is known: `this`, `super`, a class or
 * namespace, a module, an object literal, or a local built with `new C()` or
 * typed `C`. Anything else resolves to nothing, and makes no link.
 */

import { scopeAt, type Binding, type ExportEntry, type FileFacts, type Site, type Unit } from "./facts.ts";
import { requireSpec } from "./facts/modules.ts";
import { propName, unwrap } from "./facts/nodes.ts";
import { lookup, NS, TYPE, VALUE } from "./facts/scopes.ts";
import { createEvaluator, importOf, positional, type Evaluator } from "./linker/evaluator.ts";
import type { PathMapping } from "./linker/paths.ts";
import { namespace, unknown, type Val } from "./linker/values.ts";
import { child } from "./syntax.ts";

export { builtinRule } from "./linker/builtins.ts";

export type LinkerConfig = {
    /** tsconfig `paths` that apply to a file, targets already joined to `baseUrl` and made repo-relative. */
    paths: (from: string) => readonly PathMapping[];
    /** The file a bare import stands for in this repository (`builtinRule`), or null. */
    builtin: (spec: string) => string | null;
};

/** A reference that resolved: where it is, how it refers, and the declarations it names; `alt`, the one whose card stands for them where they have none (a constructor's class). */
export type Ref = { path: string; start: number; line: number; ref: Site["ref"]; units: Unit[]; alt?: Unit };

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

/** The declarations one site names; none when it names a local, a key, a global, a package or a member of anything unknown. */
const siteResolver = ({ byPath, resolveModule, importVal, moduleVal, exportVal, bindingVal, evalExpr, receiverVal, memberOf }: Evaluator) => {
    const resolveSite = (f: FileFacts, s: Site): Unit[] => {
        if (s.importEntry) return s.importEntry.imported === "*" ? [] : importVal(f, s.importEntry).units;
        if (s.keyPath) return requiredUnits(f, s.node, s.keyPath);
        if (s.exportEntry) return exportedUnits(f, s.exportEntry);
        return s.form === "bare" ? bareUnits(f, s) : memberUnits(f, s);
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
        const b = lookup(s.scope, s.name, f.flat.type[s.node] === "type_identifier" ? TYPE : VALUE | NS);
        if (!b) return [];
        if (b.kind === "import") {
            // A namespace import or whole-module require names no declaration itself.
            const entry = importOf(f, b);
            return entry && (entry.imported === "*" || entry.imported === "=") ? [] : bindingVal(f, b).units;
        }
        // `const X = require('m')` (or a member of it) is an alias, as TypeScript reads JavaScript: X also names what it holds.
        return b.unit ? [b.unit, ...requireAlias(f, b)] : [];
    };

    const memberUnits = (f: FileFacts, s: Site): Unit[] => {
        const t = f.flat;
        // `A.B` in a type is a namespace's member.
        const receiver = t.type[t.parent[s.node]] === "nested_type_identifier" ? evalExpr(f, s.receiver) : receiverVal(f, s.receiver);
        const hit = memberOf(receiver, s.name, s.ref === "write");
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
