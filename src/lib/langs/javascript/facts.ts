/**
 * What one JavaScript or TypeScript file says, read from its syntax tree: the
 * declarations a card can stand for (units, `facts/units.ts`), the scopes and
 * the names each binds, every identifier that refers to something (sites),
 * the file's imports and exports, and the members of its classes and object
 * literals (shapes).
 */

import { child, lineOf, textOf, type Flat, type Syntax } from "../../syntax.ts";
import type { RefKind, Unit } from "../pack.ts";
import { componentOf, componentReading, type Block, type Component } from "./components.ts";
import { modulesOf } from "./facts/modules.ts";
import { scopesOf } from "./facts/scopes.ts";
import { shapesOf } from "./facts/shapes.ts";
import { sitesOf } from "./facts/sites.ts";
import { unitsOf } from "./facts/units.ts";

export type BindingKind = "var" | "let" | "const" | "param" | "function" | "class" | "import" | "type" | "enum" | "namespace" | "catch" | "typeparam";

export type Binding = {
    name: string;
    /** What the name means: `VALUE`, `TYPE` and `NS` flags (`facts/scopes.ts`). */
    meaning: number;
    kind: BindingKind;
    /** The name token. */
    node: number;
    /** Initializer expression, for variables and defaulted parameters. */
    init: number;
    /** Type annotation's type node. */
    typeNode: number;
    /** Where a destructured name sits in its initializer: `const { a: { b } } = x` gives b ["a", "b"]. */
    path?: string[];
    /** The declaration node: function, class, interface, enum, namespace, import specifier. */
    decl: number;
    /** A unit this binding names, at module level. */
    unit?: Unit;
};

export type ScopeKind = "module" | "function" | "arrow" | "block" | "class" | "catch" | "for" | "type";

export type Scope = {
    id: number;
    kind: ScopeKind;
    parent: Scope | null;
    bindings: Map<string, Binding[]>;
};

/** An identifier that refers to something. */
export type Site = {
    /** The name token. */
    node: number;
    start: number;
    line: number;
    name: string;
    ref: RefKind;
    form: "bare" | "member" | "import" | "export" | "require";
    scope: Scope;
    /** Member access: the object expression (`this`, `app`, `this.cursor`). */
    receiver: number;
    /** Import sites: the import entry. */
    importEntry?: ImportEntry;
    /** Require-destructuring sites: the key path into the module. */
    keyPath?: string[];
    /** Export sites: the local name or the re-export. */
    exportEntry?: ExportEntry;
};

export type ImportEntry = {
    local: string;
    spec: string;
    /** `default`, `*` (namespace), `=` (whole module: `import x = require()`), or a name. */
    imported: string;
    /** The imported name's token; for a default, namespace or `import x = require()` import, the local name's. */
    node: number;
};

export type ExportEntry =
    | { kind: "local"; name: string; local: string; nameNode: number }
    | { kind: "expr"; name: string; value: number }
    | { kind: "reexport"; name: string; spec: string; imported: string; nameNode: number }
    | { kind: "star"; spec: string }
    | { kind: "namespace"; name: string; spec: string }
    /** A component's default export: the component itself. */
    | { kind: "unit"; name: string; unit: Unit };

export type Member = {
    name: string;
    static: boolean;
    kind: "method" | "get" | "set" | "field" | "param" | "this" | "proto" | "pair" | "shorthand" | "signature";
    unit?: Unit;
    /** Value expression: field initializer, assignment right side, pair value. */
    value: number;
    /** Type node of a field or parameter property. */
    typeNode: number;
    /** A `this.x = v` that runs only on some paths (under an if, a ternary, `&&`, a loop, a catch). */
    conditional?: boolean;
    /** A class field's own node, for its JSDoc type when it has no value. */
    decl?: number;
};

export type Shape = {
    name: string;
    kind: "class" | "function" | "object" | "interface" | "namespace";
    members: Member[];
    /** `extends` expression of a class, or the extended types of an interface. */
    heritage: number[];
    /** Spread or computed keys, or an index signature, make the member list incomplete. */
    open: boolean;
};

export type FileFacts = {
    path: string;
    flat: Flat;
    /** JavaScript, whose JSDoc types TypeScript reads as declared ones (`facts/jsdoc.ts`). */
    docTypes: boolean;
    units: Unit[];
    module: Scope;
    /** Every scope, by id. */
    scopes: Scope[];
    /** Per node, the id of the scope it sits in. */
    scopeIds: Int32Array;
    sites: Site[];
    imports: ImportEntry[];
    exports: ExportEntry[];
    /** `module.exports = <expr>` or `export = <expr>`: the expression node. */
    moduleExports: number;
    /** Every module specifier: imports, re-exports, require() and import(). */
    specifiers: string[];
    /** Shapes by declaration node: classes, constructor functions, object literals, interfaces, namespaces. */
    shapes: Map<number, Shape>;
    /** `const P = X.prototype` and `const P = (X.prototype = {})`: P's name to X's name. */
    protoAliases: Map<string, string>;
    /** Module-level `X.prototype.y = v`, `P.y = v` and `X.y = v` assignments, by X's name; `*` takes an object's members. */
    assignments: { owner: string; proto: boolean; name: string; value: number; unit?: Unit }[];
    /** A Vue or Svelte component's blocks, its inner block's scope, and its own unit, the file whole. */
    component?: { framework: Component["framework"]; blocks: Block[]; inner: Scope | null; unit: Unit };
};

/** The scope a node sits in. */
export const scopeAt = (f: FileFacts, n: number): Scope => f.scopes[f.scopeIds[n]];

/**
 * Whether a component's tree can be trusted: no syntax error in its blocks (TypeScript in a block without
 * `lang`, which a preprocessor may take, reads as JavaScript with errors that misplace names), and each
 * top-level statement inside one block (its own `;` after it, `blocksText`, included).
 */
const trusted = (t: Flat, c: Component): boolean => {
    if (t.errors > 0) return false;
    for (let n = t.first[0]; n >= 0; n = t.next[n]) {
        if (!c.blocks.some((b, i) => b.start <= t.start[n] && t.end[n] <= b.end + (i < c.blocks.length - 1 ? 1 : 0))) return false;
    }
    return true;
};

/** A component's own unit, its file whole, named as its file is: what its default export is, and where its template's changes go. */
const componentUnit = (path: string, t: Flat, units: readonly Unit[]): Unit => {
    const name = path.split("/").pop() ?? path;
    const id = units.some((u) => u.id === `${path}:1`) ? `${path}:1:${name}` : `${path}:1`;
    const end = t.text.length;
    return { id, path, name, qname: name, kind: "value", start: 0, end, startLine: 1, endLine: lineOf(t, Math.max(0, end - 1)), nameLine: 1, docLine: 1, nameStart: 0, node: 0, valueNode: -1 };
};

/** A parsed file's facts; null for a component whose tree can't be trusted, or whose blocks both declare a name. */
export const factsOf = (path: string, t: Flat): FileFacts | null => {
    const c = componentOf(path, t.text);
    if (c === null || (c && !trusted(t, c))) return null;
    const units = unitsOf(path, t, !!c);
    if (!c) {
        const scopes = scopesOf(t, units);
        const modules = modulesOf(t);
        return {
            path,
            flat: t,
            docTypes: /\.[mc]?jsx?$/i.test(path),
            units,
            module: scopes.module,
            scopes: scopes.all,
            scopeIds: scopes.scopeIds,
            sites: sitesOf(t, scopes, modules),
            ...modules,
            ...shapesOf(t, units),
        };
    }
    const blockOf = (n: number) => c.blocks.find((b) => b.start <= t.start[n] && t.start[n] <= b.end);
    // Svelte 4's `type T = $$Generic<…>` declares a type parameter of the component, not a type: no card stands for it.
    if (c.framework === "svelte") units.splice(0, units.length, ...units.filter((u) => !(u.kind === "type" && t.type[u.node] === "type_alias_declaration" && /^\$\$Generic\b/.test(textOf(t, child(t, u.node, "value"))))));
    // The outer block's `export default {…}` is the component's own options: no card of its own, its methods the component's.
    const options = units.find((u) => !u.parent && u.name === "default" && t.type[u.node] === "export_statement" && blockOf(u.node)?.inner === false);
    if (options) units.splice(units.indexOf(options), 1);
    const unit = componentUnit(path, t, units);
    for (const u of units) if (options && u.parent === options.id) u.parent = unit.id;
    units.push(unit);
    const scopes = scopesOf(t, units, { inner: (n) => !!blockOf(n)?.inner, generics: c.generics });
    if (scopes.clash) return null;
    const modules = modulesOf(t, (n) => blockOf(n)?.inner === false);
    // A component's default export is the component; the code in its blocks is never CommonJS.
    modules.exports = [...modules.exports.filter((e) => e.kind === "star" || e.name !== "default"), { kind: "unit", name: "default", unit }];
    return {
        path,
        flat: t,
        docTypes: c.grammar === "javascript",
        units,
        module: scopes.module,
        scopes: scopes.all,
        scopeIds: scopes.scopeIds,
        sites: sitesOf(t, scopes, modules),
        ...modules,
        // Module-level assignments are matched by name, which two blocks may each bind.
        ...shapesOf(t, units),
        protoAliases: new Map(),
        assignments: [],
        component: { framework: c.framework, blocks: c.blocks, inner: scopes.inner, unit },
    };
};

/** A file's facts, or null when the parser doesn't read it: no grammar for it, `@flow`, too many errors, or a component's blocks unread. */
export const parseFacts = (syntax: Syntax, path: string, text: string): FileFacts | null => {
    const reading = componentReading(path, text);
    const t = reading === null ? null : syntax.parse(path, text, reading);
    return t ? factsOf(path, t) : null;
};
