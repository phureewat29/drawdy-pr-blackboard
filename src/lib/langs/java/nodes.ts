/** Java's syntax nodes as the rule table and the resolver read them: tree-sitter-java 0.23.5's. */

import { child, hasToken, namedChildren, perTree, textOf, type Flat } from "../../syntax.ts";

export type Access = "public" | "protected" | "package" | "private";

/** A node's named children but comments, which tree-sitter puts wherever they're written: `f(a, // why\n b)` has two arguments. */
export const code = (t: Flat, n: number): number[] => namedChildren(t, n).filter((c) => t.type[c] !== "line_comment" && t.type[c] !== "block_comment");

const lastDescendants = perTree((t: Flat): Int32Array => {
    const last = new Int32Array(t.count);
    for (let n = 0; n < t.count; n++) last[n] = n;
    for (let n = t.count - 1; n > 0; n--) if (last[t.parent[n]] < last[n]) last[t.parent[n]] = last[n];
    return last;
});

/** A node's last descendant: ids run in document order, a node before its children, so its subtree is the ids from it to this one. */
export const lastDescendant = (t: Flat, n: number): number => lastDescendants(t)[n];

export const TYPE_KINDS = { class_declaration: "class", interface_declaration: "interface", enum_declaration: "enum", record_declaration: "record", annotation_type_declaration: "annotation" } as const;
export const TYPE_DECLARATIONS: ReadonlySet<string> = new Set(Object.keys(TYPE_KINDS));
export const TYPE_BODIES: ReadonlySet<string> = new Set(["class_body", "interface_body", "annotation_type_body", "enum_body_declarations"]);
export const CONSTRUCTORS: ReadonlySet<string> = new Set(["constructor_declaration", "compact_constructor_declaration"]);

/** The type declaration a body belongs to, or -1: an anonymous class's body, an enum constant's. */
const ownerOfBody = (t: Flat, body: number): number => {
    let p = t.parent[body];
    if (t.type[body] === "enum_body_declarations" && p >= 0) p = t.parent[p];
    return p >= 0 && TYPE_DECLARATIONS.has(t.type[p]) ? p : -1;
};

/** Whether a declaration is a top-level type or a member of one: a card can stand for it. */
export const isMember = (t: Flat, n: number): boolean => {
    const p = t.parent[n];
    if (p < 0) return false;
    if (t.type[p] === "program") return true;
    if (!TYPE_BODIES.has(t.type[p])) return false;
    const owner = ownerOfBody(t, p);
    return owner >= 0 && isMember(t, owner);
};

/** An anonymous class's body, or an enum constant's: a class of its own. */
export const isAnonymousBody = (t: Flat, n: number): boolean => t.type[n] === "class_body" && (t.type[t.parent[n]] === "object_creation_expression" || t.type[t.parent[n]] === "enum_constant");

export const isAnnotation = (t: Flat, n: number): boolean => t.type[n] === "annotation" || t.type[n] === "marker_annotation";

/** `var x = …`: a type to infer, never one written. */
export const isVar = (t: Flat, type: number): boolean => type >= 0 && t.type[type] === "type_identifier" && textOf(t, type) === "var";

/** A varargs parameter's element type, `Foo` of `Foo... xs`. */
export const spreadType = (t: Flat, n: number): number => namedChildren(t, n).find((c) => t.type[c] !== "modifiers" && t.type[c] !== "variable_declarator" && !isAnnotation(t, c)) ?? -1;

const PRIMITIVE_TYPES: ReadonlySet<string> = new Set(["integral_type", "floating_point_type", "boolean_type"]);

/** Whether a type node is a primitive type: `int`, `double`, `boolean`. */
export const isPrimitiveType = (t: Flat, n: number): boolean => PRIMITIVE_TYPES.has(t.type[n]);

/** A declaration's parameters, or a record's components: the receiver parameter aside. */
export const parametersOf = (t: Flat, decl: number): number[] => namedChildren(t, child(t, decl, "parameters")).filter((c) => t.type[c] === "formal_parameter" || t.type[c] === "spread_parameter");

/** The number of `[]` a dimensions node writes. */
export const dimsOf = (t: Flat, dims: number): number => (dims < 0 ? 0 : (textOf(t, dims).match(/\[/g) ?? []).length);

/** A dotted spec's names: `a.b` gives [a, b], "" none. */
export const namesOf = (spec: string): string[] => (spec ? spec.split(".") : []);

/** A dotted name's parts: `a.b.C`. */
export const dotted = (t: Flat, n: number): string[] => (n < 0 ? [] : t.type[n] === "scoped_identifier" ? [...dotted(t, child(t, n, "scope")), textOf(t, child(t, n, "name"))] : [textOf(t, n)]);

/** A type node's name as written, without its type arguments or annotations: `a.b.Foo` gives `[a, b, Foo]`; [] for a primitive, an array, `var`. */
export const typeParts = (t: Flat, n: number): string[] => {
    if (n < 0) return [];
    switch (t.type[n]) {
        case "type_identifier":
            return isVar(t, n) ? [] : [textOf(t, n)];
        case "generic_type":
            return typeParts(t, namedChildren(t, n)[0] ?? -1);
        case "annotated_type":
            return typeParts(t, namedChildren(t, n).find((c) => !isAnnotation(t, c)) ?? -1);
        case "scoped_type_identifier": {
            const parts = code(t, n).filter((c) => !isAnnotation(t, c));
            const head = typeParts(t, parts[0] ?? -1);
            return parts.length > 1 && head.length > 0 ? [...head, textOf(t, parts[parts.length - 1])] : [];
        }
        default:
            return [];
    }
};

/** The supertypes a declaration writes, `extends` and `implements`; an anonymous class's base. */
export const supertypeNodes = (t: Flat, n: number): number[] => {
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

export const hasModifier = (t: Flat, decl: number, word: string): boolean => {
    const mods = namedChildren(t, decl).find((c) => t.type[c] === "modifiers") ?? -1;
    return mods >= 0 && hasToken(t, mods, word);
};

/** A declaration's access: what it writes, else an interface member's public, else the package's. */
export const accessOf = (t: Flat, decl: number, inInterface: boolean): Access =>
    hasModifier(t, decl, "private") ? "private" : hasModifier(t, decl, "protected") ? "protected" : inInterface || hasModifier(t, decl, "public") ? "public" : "package";

/** A creation's body, when it makes an anonymous class: `new T(…) { … }` extends T rather than calls it. */
export const anonymousBody = (t: Flat, creation: number): number | undefined => namedChildren(t, creation).find((c) => t.type[c] === "class_body");

/** `outer.new Inner()`: the type is a member of outer's class, never a name in scope. */
export const qualifiedCreation = (t: Flat, creation: number): boolean => code(t, creation).some((c) => t.field[c] === "" && t.type[c] !== "class_body" && !isAnnotation(t, c));

/** The creation a type name is the class of, `new Foo()`, `new a.b.Foo()`, `new Foo<>()`, or -1. */
export const creationOf = (t: Flat, n: number): number => {
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

/** Whether an identifier sits in a type: a type's name, an annotation's, a record pattern's. */
export const isType = (t: Flat, n: number): boolean => t.type[n] === "type_identifier" || t.type[t.parent[n]] === "marker_annotation" || t.type[t.parent[n]] === "annotation" || t.type[t.parent[n]] === "record_pattern";

/** Whether a site may name a type: a type's name, an annotation's, a record pattern's, or a name `.` or `::` follows. */
export const mayBeType = (t: Flat, n: number): boolean => {
    if (t.type[n] === "type_identifier") return true;
    const p = t.parent[n];
    const pt = t.type[p];
    if ((pt === "marker_annotation" || pt === "annotation") && t.field[n] === "name") return true;
    if (pt === "record_pattern" || ((pt === "method_invocation" || pt === "field_access") && t.field[n] === "object")) return true;
    return pt === "method_reference" && code(t, p)[0] === n;
};

export const argCount = (t: Flat, call: number): number => code(t, child(t, call, "arguments")).length;
