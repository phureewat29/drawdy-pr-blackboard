/**
 * The C# files of one resolution, each read as its namespaces, using
 * directives and type declarations, and each type's members. Every cache
 * keyed by a `CFile` or a `CType` is one resolution's: each reads the files
 * anew.
 */

import type { GFile } from "../../anyfacts.ts";
import { memoize, pushTo } from "../../fp.ts";
import { child, hasToken, textOf, type Flat } from "../../syntax.ts";
import type { Unit } from "../pack.ts";
import { bare, code, conditional, doubtOf, dotted, hasModifier, headerIf, holder, modifiers, parameterList, paramsOf, TYPE_DECLARATIONS, TYPE_KINDS, typeParams, type Param, type TypeKind } from "./nodes.ts";

export type Access = "public" | "internal" | "protected" | "private" | "protected internal" | "private protected";

/** A type declaration of a file read. */
export type CType = {
    id: number;
    file: CFile;
    node: number;
    name: string;
    arity: number;
    kind: TypeKind | "delegate";
    /** A `record struct` or a `struct`: a value type. */
    value: boolean;
    /** A `ref struct`, never boxed, or may be: a part of a partial struct (another part may say `ref`). */
    refStruct: boolean;
    outer: CType | null;
    /** Its namespace, dotted; "" for the global one. */
    ns: string;
    unit: Unit | undefined;
    partial: boolean;
    /** `file class X`: seen in its own file alone. */
    fileLocal: boolean;
    /** Declared inside `#if`: some builds lack it. */
    conditional: boolean;
};

/** A member a type declares: a method, a constructor, a property, a field, an event, a nested type. */
export type CMember = {
    kind: "method" | "ctor" | "property" | "field" | "event" | "type" | "constant" | "other";
    name: string;
    owner: CType;
    node: number;
    unit: Unit | undefined;
    isStatic: boolean;
    override: boolean;
    access: Access;
    /** `void IFoo.Run()`: reached through the interface alone. */
    explicit: boolean;
    conditional: boolean;
    /** Methods and constructors: their parameters, and how many type parameters they take. */
    params: Param[];
    arity: number;
    /** The written type: a property's or a field's, a method's result; -1 for none. */
    type: number;
    /** The nested type a `type` member is. */
    nested?: CType;
    /** A record's member made from its parameters, or a primary constructor. */
    implicit?: true;
};

/** What a file's lookups see past it: the files read in a folder, and whether a file is compiled for sure (`msbuild.ts`). */
export type Program = { folder: (dir: string) => readonly CFile[]; compiled: (path: string) => boolean };

export type CFile = {
    f: GFile;
    t: Flat;
    path: string;
    dir: string;
    program: Program;
    types: CType[];
    byNode: Map<number, CType>;
    /** Why tree-sitter's reading may not be the compiler's (`doubtOf`): then the file declares nothing and draws nothing. */
    doubt: string | null;
    /** The namespace a node is in. */
    nsAt: (n: number) => string;
};

const dirOf = (path: string) => path.split("/").slice(0, -1).join("/");

/** Reads the files of one resolution: a file's types, numbered across all of them, the first time it is asked for; a doubtful file's none. */
export const readFiles = (files: readonly GFile[], compiled: (path: string) => boolean): ((f: GFile) => CFile) => {
    let ids = 0;
    const byDir = new Map<string, GFile[]>();
    for (const f of files) pushTo(byDir, dirOf(f.path), f);
    const program: Program = { folder: (dir) => (byDir.get(dir) ?? []).map((f) => cfileOf(f)), compiled: memoize(compiled) };
    const cfileOf = memoize((f: GFile): CFile => {
        const t = f.flat;
        // The file-scoped namespace, which holds every declaration after it.
        const scoped = code(t, 0).find((c) => t.type[c] === "file_scoped_namespace_declaration");
        const scopedName = scoped !== undefined ? dotted(t, child(t, scoped, "name")).join(".") : "";
        const nsAt = (n: number): string => {
            const parts: string[] = [];
            for (let x = t.parent[n]; x > 0; x = t.parent[x]) if (t.type[x] === "namespace_declaration") parts.unshift(dotted(t, child(t, x, "name")).join("."));
            if (scoped !== undefined && t.start[n] >= t.end[scoped]) parts.unshift(scopedName);
            return parts.join(".");
        };
        const cf: CFile = { f, t, path: f.path, dir: dirOf(f.path), program, types: [], byNode: new Map(), doubt: doubtOf(t), nsAt };
        for (let n = 0; n < (cf.doubt ? 0 : t.count); n++) {
            const ty = t.type[n];
            if (!TYPE_DECLARATIONS.has(ty) && ty !== "delegate_declaration") continue;
            const name = child(t, n, "name");
            if (name < 0) continue;
            let outer: CType | null = null;
            for (let x = t.parent[n]; x >= 0 && !outer; x = t.parent[x]) outer = cf.byNode.get(x) ?? null;
            const mods = modifiers(t, n);
            const T: CType = {
                id: ids++,
                file: cf,
                node: n,
                name: bare(textOf(t, name)),
                arity: typeParams(t, n).length,
                kind: ty === "delegate_declaration" ? "delegate" : TYPE_KINDS[ty as keyof typeof TYPE_KINDS],
                value: ty === "struct_declaration" || (ty === "record_declaration" && hasToken(t, n, "struct")),
                refStruct: ty === "struct_declaration" && (hasToken(t, n, "ref") || mods.includes("partial")),
                outer,
                ns: nsAt(n),
                unit: f.unitByNode.get(n),
                partial: mods.includes("partial"),
                fileLocal: mods.includes("file"),
                conditional: conditional(t, n),
            };
            cf.types.push(T);
            cf.byNode.set(n, T);
        }
        return cf;
    });
    return cfileOf;
};

/** The node holding a type's members, or -1. */
export const bodyOf = (T: CType): number => child(T.file.t, T.node, "body");

/** A declaration's access: what it writes, else an interface member's public, else a member's private and a top-level type's internal. */
export const accessOf = (t: Flat, decl: number, inInterface: boolean): Access => {
    const m = modifiers(t, decl);
    if (m.includes("private") && m.includes("protected")) return "private protected";
    if (m.includes("protected") && m.includes("internal")) return "protected internal";
    for (const a of ["public", "internal", "protected", "private"] as const) if (m.includes(a)) return a;
    if (inInterface) return "public";
    return t.type[holder(t, decl)] === "declaration_list" && TYPE_DECLARATIONS.has(t.type[holder(t, holder(t, decl))]) ? "private" : "internal";
};

const MEMBER_KINDS: Record<string, CMember["kind"]> = {
    method_declaration: "method",
    constructor_declaration: "ctor",
    property_declaration: "property",
    indexer_declaration: "other",
    event_declaration: "event",
    operator_declaration: "other",
    conversion_operator_declaration: "other",
    destructor_declaration: "other",
};

/** A type's members by name: what its body declares, through `#if`, and what a record's or a primary constructor's parameters make. */
export const membersOf = memoize(
    (T: CType): Map<string, CMember[]> => {
        const t = T.file.t;
        const out = new Map<string, CMember[]>();
        const iface = T.kind === "interface";
        const add = (m: CMember) => pushTo(out, m.name, m);
        const base = (node: number, name: string, kind: CMember["kind"]): CMember => ({
            kind,
            name,
            owner: T,
            node,
            unit: T.file.f.unitByNode.get(node),
            isStatic: hasModifier(t, node, "static") || hasModifier(t, node, "const"),
            override: hasModifier(t, node, "override"),
            access: accessOf(t, node, iface),
            explicit: code(t, node).some((c) => t.type[c] === "explicit_interface_specifier"),
            conditional: conditional(t, node),
            params: [],
            arity: 0,
            type: -1,
        });
        const visit = (list: number) => {
            for (const c of code(t, list)) {
                const ty = t.type[c];
                if (ty === "preproc_if" || ty === "preproc_elif" || ty === "preproc_else") {
                    visit(c);
                    continue;
                }
                if (TYPE_DECLARATIONS.has(ty) || ty === "delegate_declaration") {
                    const nested = T.file.byNode.get(c);
                    if (nested) add({ ...base(c, nested.name, "type"), nested, arity: nested.arity });
                    continue;
                }
                if (ty === "field_declaration" || ty === "event_field_declaration") {
                    const decl = code(t, c).find((x) => t.type[x] === "variable_declaration") ?? -1;
                    const type = child(t, decl, "type");
                    for (const v of code(t, decl)) if (t.type[v] === "variable_declarator") add({ ...base(c, bare(textOf(t, child(t, v, "name"))), ty === "field_declaration" ? (hasModifier(t, c, "const") ? "constant" : "field") : "event"), type });
                    continue;
                }
                if (ty === "enum_member_declaration") {
                    add({ ...base(c, bare(textOf(t, child(t, c, "name"))), "constant"), isStatic: true, access: "public" });
                    continue;
                }
                const kind = MEMBER_KINDS[ty];
                if (!kind) continue;
                const nameNode = child(t, c, "name");
                const name = ty === "indexer_declaration" ? "this[]" : nameNode >= 0 ? bare(textOf(t, nameNode)) : `#${ty}`;
                const m = base(c, name, kind);
                m.params = paramsOf(t, parameterList(t, c));
                m.arity = typeParams(t, c).length;
                m.type = child(t, c, ty === "method_declaration" ? "returns" : "type");
                add(m);
            }
        };
        visit(bodyOf(T));
        // A primary constructor, and a record's properties made from its parameters.
        const list = code(t, T.node).find((c) => t.type[c] === "parameter_list");
        if (list !== undefined) {
            const ps = paramsOf(t, list);
            add({ ...base(T.node, T.name, "ctor"), params: ps, access: "public", isStatic: false, override: false, explicit: false, unit: T.unit, implicit: true });
            if (T.kind === "record") for (const p of ps) if (!out.has(p.name)) add({ ...base(T.node, p.name, "property"), access: "public", isStatic: false, override: false, explicit: false, unit: undefined, type: p.type, implicit: true });
        }
        return out;
    },
    { cache: new WeakMap() }
);

/**
 * Whether a type's declaration may not hold all its members: a part of a
 * partial type (the others may be in files not read), one inside `#if`, or
 * one whose header holds an `#if` (some builds write another base).
 */
export const openOf = memoize((T: CType): boolean => T.partial || T.conditional || headerIf(T.file.t, T.node), { cache: new WeakMap() });
