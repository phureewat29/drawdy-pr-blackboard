/**
 * What one JavaScript or TypeScript file says, read from its syntax tree: the
 * declarations a card can stand for (units, `facts/units.ts`), the scopes and
 * the names each binds, every identifier that refers to something (sites),
 * the file's imports and exports, and the members of its classes and object
 * literals (shapes).
 */

import type { Flat, Syntax } from "../../syntax.ts";
import type { RefKind, Unit } from "../pack.ts";
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
    | { kind: "namespace"; name: string; spec: string };

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
};

/** The scope a node sits in. */
export const scopeAt = (f: FileFacts, n: number): Scope => f.scopes[f.scopeIds[n]];

/** A parsed file's facts. */
export const factsOf = (path: string, t: Flat): FileFacts => {
    const units = unitsOf(path, t);
    const scopes = scopesOf(t, units);
    const modules = modulesOf(t);
    return {
        path,
        flat: t,
        units,
        module: scopes.module,
        scopes: scopes.all,
        scopeIds: scopes.scopeIds,
        sites: sitesOf(t, scopes, modules),
        ...modules,
        ...shapesOf(t, units),
    };
};

/** A file's facts, or null when the parser doesn't read it: no grammar for it, `@flow`, or too many errors. */
export const parseFacts = (syntax: Syntax, path: string, text: string): FileFacts | null => {
    const t = syntax.parse(path, text);
    return t ? factsOf(path, t) : null;
};
