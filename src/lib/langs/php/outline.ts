/**
 * What a PHP file declares and how its names read, from its syntax alone:
 * its namespaces and the `use` imports in each, and its class-likes with
 * their members and supertypes. Class and method names are keyed
 * lowercase, as PHP compares them.
 */

import { child, namedChildren, perTree, textOf, type Flat } from "../../syntax.ts";
import { atTop, CLASS_LIKES, classNameNode, kindOf, lastOf, modifiers, nameText } from "./nodes.ts";
import { PHP_RULES } from "./rules.ts";

/** A class `use` import: the name it binds (lowercase), what it names, where it starts to apply, and its site's node. */
export type Use = { alias: string; target: string; at: number; node: number };

/** A namespace's stretch of a file: `namespace A;` up to the next one, or a braced `namespace A { … }`. */
export type Space = { ns: string; start: number; end: number; uses: Use[] };

/** A method or a property (a promoted constructor parameter's too): its node or written type (-1 for none), and modifiers. */
export type Member = { node: number; vis: string; isStatic: boolean; isAbstract: boolean };

/** A class-like declaration. */
export type ClassDecl = {
    node: number;
    kind: string;
    /** Its name with its namespace's, as written. */
    fqn: string;
    /** Run whenever the file runs: a statement of the file or its namespace. */
    top: boolean;
    isAbstract: boolean;
    /** The name nodes it extends (an interface: its parents are interfaces), implements, and takes traits from. */
    parents: number[];
    interfaces: number[];
    traits: number[];
    /** Method names a trait `use` block adapts (`insteadof`, `as`), lowercase: those its traits give are unknown. */
    adapted: Set<string>;
    /** By lowercase name; null where two declare one name. */
    methods: Map<string, Member | null>;
    props: Map<string, Member>;
};

export type Outline = { spaces: Space[]; byNode: Map<number, ClassDecl> };

const member = (t: Flat, n: number, node: number, iface = false): Member => {
    const m = modifiers(t, n);
    return { node, vis: /private|protected/.exec(m)?.[0] ?? "public", isStatic: m.includes("static"), isAbstract: iface || m.includes("abstract") };
};

/** The names in a clause: `extends A, B`, `implements C`. */
const namesIn = (t: Flat, n: number | undefined): number[] => (n === undefined ? [] : namedChildren(t, n).map((c) => classNameNode(t, c)).filter((c) => c >= 0));

/** A class-like's members, supertypes and trait adaptations. */
const classOf = (t: Flat, n: number, ns: string): ClassDecl => {
    const kind = kindOf(t.type[n]);
    const name = textOf(t, child(t, n, "name"));
    const kids = namedChildren(t, n);
    const base = namesIn(t, kids.find((c) => t.type[c] === "base_clause"));
    const impl = namesIn(t, kids.find((c) => t.type[c] === "class_interface_clause"));
    const iface = kind === "interface";
    const d: ClassDecl = { node: n, kind, fqn: name && (ns ? `${ns}\\${name}` : name), top: atTop(t, n), isAbstract: modifiers(t, n).includes("abstract"), parents: iface ? [] : base, interfaces: iface ? base : impl, traits: [], adapted: new Set(), methods: new Map(), props: new Map() };
    for (const m of namedChildren(t, child(t, n, "body"))) {
        const ty = t.type[m];
        if (ty === "use_declaration") {
            for (const c of namedChildren(t, m)) {
                if (t.type[c] !== "use_list") d.traits.push(c);
                // Every name an adaptation writes: the methods, their aliases.
                else for (let x = c, last = lastOf(t, c); x <= last; x++) if (t.type[x] === "name") d.adapted.add(textOf(t, x).toLowerCase());
            }
        } else if (ty === "method_declaration") {
            const key = textOf(t, child(t, m, "name")).toLowerCase();
            d.methods.set(key, d.methods.has(key) ? null : member(t, m, m, iface));
            // A promoted constructor parameter is a property too.
            if (key === "__construct") for (const p of namedChildren(t, child(t, m, "parameters"))) if (t.type[p] === "property_promotion_parameter" && t.type[child(t, p, "name")] === "variable_name") d.props.set(textOf(t, child(t, p, "name")).slice(1), member(t, p, child(t, p, "type")));
        } else if (ty === "property_declaration") {
            for (const el of namedChildren(t, m)) if (t.type[el] === "property_element") d.props.set(textOf(t, child(t, el, "name")).slice(1), member(t, m, child(t, m, "type")));
        }
    }
    return d;
};

/** The namespace stretch an offset sits in. */
export const spaceAt = (o: Outline, at: number): Space => {
    let best: Space | null = null;
    for (const s of o.spaces) if (s.start <= at && at < s.end && (!best || s.end - s.start < best.end - best.start)) best = s;
    return best ?? o.spaces[0];
};

export const outlineOf = perTree((t: Flat): Outline => {
    // Code before any `namespace` is the global namespace's.
    let open: Space = { ns: "", start: 0, end: t.text.length, uses: [] };
    const o: Outline = { spaces: [open], byNode: new Map() };
    for (const n of namedChildren(t, 0)) {
        if (t.type[n] !== "namespace_definition") continue;
        const ns = nameText(t, child(t, n, "name"));
        const body = child(t, n, "body");
        if (body >= 0) o.spaces.push({ ns, start: t.start[body], end: t.end[body], uses: [] });
        else {
            open.end = t.start[n];
            o.spaces.push((open = { ns, start: t.end[n], end: t.text.length, uses: [] }));
        }
    }
    // `use function` and `use const` bring no class.
    for (const i of PHP_RULES.imports(t)) {
        let clause = i.node;
        while (t.type[clause] !== "namespace_use_clause") clause = t.parent[clause];
        if (child(t, clause, "type") < 0 && child(t, i.stmt, "type") < 0) spaceAt(o, t.start[i.stmt]).uses.push({ alias: i.local.toLowerCase(), target: i.spec ? `${i.spec}\\${i.name}` : i.name!, at: t.start[i.stmt], node: i.node });
    }
    for (let n = 1; n < t.count; n++) if (CLASS_LIKES.has(t.type[n])) o.byNode.set(n, classOf(t, n, spaceAt(o, t.start[n]).ns));
    return o;
});
