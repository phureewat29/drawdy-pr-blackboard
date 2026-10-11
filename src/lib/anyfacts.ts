/**
 * What one file says, for the languages read by rule tables (`langs/`):
 * the declarations a card can stand for (units, from the grammar's own
 * `tags.scm`), the scopes and the names each binds, every identifier that
 * may refer to a declaration (sites), and the file's imports.
 *
 * Nothing here knows a language. The rule table says which nodes open
 * scopes, which nodes bind which names, what an identifier is (a
 * declaration's name, a member after `.`, a segment after `::`, or a bare
 * name), and how imports read. The resolver (`anylink.ts`) follows the
 * sites.
 */

import type { FileFacts, Unit, UnitKind } from "./facts.ts";
import { lineOf, prevSibling, textOf, type Flat } from "./syntax.ts";

export type ScopeKind = "module" | "function" | "class" | "block";

export type GScope = {
    id: number;
    node: number;
    kind: ScopeKind;
    parent: GScope | null;
    names: Map<string, GBinding[]>;
};

export type BindingKind = "def" | "type" | "param" | "local" | "import" | "global" | "nonlocal" | "self" | "selfclass";

export type GBinding = {
    name: string;
    /** The name token. */
    node: number;
    kind: BindingKind;
    scope: GScope;
    /** The unit this name declares: a function, a class, a type. */
    unit?: Unit;
    import?: GImport;
    /** A written type: an annotation, a parameter's or a receiver's type. */
    typeNode?: number;
    /** The value it was bound to. */
    init?: number;
    /** Which result of the call `init` is: `x, err := f()` binds x to result 0. */
    initResult?: number;
    /** Where the name starts to be seen in its scope: a Go or Rust local, after its statement. Absent, the whole scope sees it. */
    from?: number;
};

export type GImport = {
    /** The name it binds in the file; "" for a star import, which binds nothing it names. */
    local: string;
    /** The module as written: `a.b`, `github.com/x/y`, `crate::a::b`. */
    spec: string;
    /** Python's leading dots; 0 elsewhere. */
    level: number;
    /** The name taken from the module, null when the module itself is bound, "*" for a star import. */
    name: string | null;
    /** The imported name's token, or -1. */
    node: number;
    /** The token that binds `local`, or -1. */
    bind: number;
    /** The import statement. */
    stmt: number;
    /** `local` is guessed from the path (Go, with no name written): it binds only where the module's own name is `local`. */
    implicit?: true;
    /** Where it runs, the file may have changed where modules come from (Python's `sys.path`): it names nothing. */
    unproven?: true;
};

export type RefKind = "call" | "value" | "type" | "import";

export type GSite = {
    node: number;
    start: number;
    line: number;
    name: string;
    /** Bare `f`, member `x.f` (the receiver is x), or path `a::f` (the receiver is a). */
    shape: "bare" | "member" | "path";
    receiver: number;
    ref: RefKind;
    scope: GScope;
};

/** A class-like unit's members by name. */
export type Members = Map<string, Unit[]>;

export type Role =
    | { kind: "decl" }
    | { kind: "skip" }
    | { kind: "bare"; expr: number }
    | { kind: "member"; receiver: number; expr: number }
    | { kind: "path"; receiver: number; expr: number };

export type Emit = (nameNode: number, kind: BindingKind, opts?: { to?: "function" | "module"; typeNode?: number; init?: number; initResult?: number; import?: GImport; unitNode?: number; name?: string; from?: number }) => void;

type UnitRule = { kind: UnitKind; nameNode: number; outer: number };

export type LangRules = {
    /** A `tags.scm` definition capture on a node, as a unit, or null. */
    unit: (t: Flat, capture: string, node: number) => UnitRule | null;
    /** Units the tags don't define: Rust's impl blocks. */
    extraUnits?: (t: Flat) => (UnitRule & { node: number })[];
    /** Whether a definition joins the one of the same name right before it, as one unit: Python's `@overload` signatures, a property's setter. */
    continues?: (t: Flat, previous: number, node: number) => boolean;
    /** A unit's card name, given the unit it sits in. */
    label: (t: Flat, u: Unit, parent: Unit | undefined) => string;
    /** The scope a node opens, if any. */
    scope: (t: Flat, n: number) => ScopeKind | null;
    /** Whether a node is read in the scope around the one it sits in: Python's default values and annotations, before the function runs. */
    outside?: (t: Flat, n: number) => boolean;
    /** The names a node binds. Called once per node, in tree order. */
    binds: (t: Flat, n: number, emit: Emit) => void;
    /** Identifier node types that may refer to something. */
    identifiers: ReadonlySet<string>;
    role: (t: Flat, n: number) => Role;
    /** Whether an expression is the callee of a call. */
    isCallee: (t: Flat, expr: number) => boolean;
    /** Whether an identifier sits in a type. */
    isType: (t: Flat, n: number) => boolean;
    imports: (t: Flat) => GImport[];
    /** The base type expressions of a class-like unit that holds members by nesting, or null when the unit is no such declaration. */
    classOf?: (t: Flat, unitNode: number) => { bases: number[] } | null;
};

export type GFile = {
    path: string;
    rules: LangRules;
    flat: Flat;
    /** In order of where they start. */
    units: Unit[];
    /** Each unit's card name, by unit id. */
    labels: Map<string, string>;
    module: GScope;
    /** By scope id. */
    scopes: GScope[];
    /** The scope each node that opens one opens. */
    scopeOfNode: Map<number, GScope>;
    /** The innermost scope around each node, by scope id; a node that opens a scope has its own. */
    enclosing: Int32Array;
    sites: GSite[];
    imports: GImport[];
    /** The scope each import belongs to: the module, an inline module, a block. */
    importScope: Map<GImport, GScope>;
    /** Each class-like unit's members, by unit id. */
    members: Map<string, Members>;
    /** Each class-like unit's base type expressions, by unit id. */
    bases: Map<string, number[]>;
    /** The unit each declaration node stands for: a joined definition's nodes all give its unit. */
    unitByNode: Map<number, Unit>;
};

/** Whether a parsed file is read by a rule table rather than by `facts.ts`. */
export const isGeneric = (f: FileFacts | GFile): f is GFile => "rules" in f;

/** The scope a node sits in: for a node that opens one, the scope around it. */
export const scopeAround = (f: GFile, n: number): GScope => {
    const s = f.scopes[f.enclosing[n]];
    return s.node === n && n !== 0 ? (s.parent ?? f.module) : s;
};

const KIND_ORDER: Record<UnitKind, number> = { class: 0, type: 1, namespace: 2, function: 3, method: 4, value: 5 };

/** The first line of the comments right above a node, with no blank line between. */
const docStartOf = (t: Flat, n: number): number => {
    let first = t.start[n];
    for (let p = prevSibling(t, n); p >= 0 && /comment/.test(t.type[p]); p = prevSibling(t, p)) {
        const between = t.text.slice(t.end[p], first);
        if ((between.match(/\n/g) ?? []).length > 1) break;
        first = t.start[p];
    }
    return first;
};

/**
 * The units of a file from its `tags.scm` definitions and the rule table:
 * functions, classes and types at any depth outside a function body, and
 * the methods of classes. A function inside another function belongs to
 * it. A definition that continues the one right before it (`continues`)
 * joins its unit.
 */
const unitsOf = (path: string, t: Flat, rules: LangRules): { units: Unit[]; unitByNode: Map<number, Unit>; labels: Map<string, string> } => {
    const found = new Map<number, UnitRule & { node: number }>();
    for (const c of t.tags ?? []) {
        const r = rules.unit(t, c.capture, c.node);
        if (!r) continue;
        const prev = found.get(c.node);
        if (!prev || KIND_ORDER[r.kind] > KIND_ORDER[prev.kind]) found.set(c.node, { ...r, node: c.node });
    }
    for (const r of rules.extraUnits?.(t) ?? []) if (!found.has(r.node)) found.set(r.node, r);
    const all = [...found.values()].map((r) => ({ r, start: t.start[r.outer], end: Math.max(t.end[r.outer], t.end[r.node]) })).sort((a, b) => a.start - b.start || b.end - a.end);
    const units: Unit[] = [];
    const unitByNode = new Map<number, Unit>();
    const ids = new Set<string>();
    const parentOf = new Map<Unit, Unit>();
    // The units holding the one being read, outermost first.
    const open: Unit[] = [];
    // The unit made last and the node it last took in, which a continuing definition may join.
    let last: { unit: Unit; node: number; parent: Unit | undefined } | null = null;
    for (const { r, start, end } of all) {
        while (open.length > 0 && !(open[open.length - 1].start <= start && end <= open[open.length - 1].end)) open.pop();
        const parent = open[open.length - 1];
        if (parent && (parent.kind === "function" || parent.kind === "method")) continue;
        const name = textOf(t, r.nameNode);
        if (last && last.parent === parent && last.unit.name === name && rules.continues?.(t, last.node, r.node)) {
            last.unit.end = Math.max(last.unit.end, end);
            last.unit.endLine = lineOf(t, Math.max(last.unit.start, last.unit.end - 1));
            last.node = r.node;
            unitByNode.set(r.node, last.unit);
            continue;
        }
        const nameStart = t.start[r.nameNode];
        const kind: UnitKind = r.kind === "function" && parent && (parent.kind === "class" || parent.kind === "type") ? "method" : r.kind;
        const u: Unit = {
            id: "",
            path,
            name,
            qname: parent ? `${parent.qname}.${name}` : name,
            kind,
            start,
            end,
            startLine: lineOf(t, start),
            endLine: lineOf(t, Math.max(start, end - 1)),
            nameLine: lineOf(t, nameStart),
            docLine: lineOf(t, docStartOf(t, r.outer)),
            nameStart,
            ...(parent ? { parent: parent.id } : {}),
            node: r.node,
            valueNode: r.node,
        };
        // `path:nameLine`, as `facts.ts` names units; two on one line take their names, then a count.
        let id = `${path}:${u.nameLine}`;
        if (ids.has(id)) id = `${path}:${u.nameLine}:${name}`;
        for (let k = 2; ids.has(id); k++) id = `${path}:${u.nameLine}:${name}:${k}`;
        u.id = id;
        ids.add(id);
        units.push(u);
        unitByNode.set(r.node, u);
        if (parent) parentOf.set(u, parent);
        open.push(u);
        last = { unit: u, node: r.node, parent };
    }
    const labels = new Map(units.map((u) => [u.id, rules.label(t, u, parentOf.get(u))]));
    return { units, unitByNode, labels };
};

/** Reads a file with its language's rules. */
export const indexFile = (path: string, t: Flat, rules: LangRules): GFile => {
    const { units, unitByNode, labels } = unitsOf(path, t, rules);

    const module: GScope = { id: 0, node: 0, kind: "module", parent: null, names: new Map() };
    const scopes: GScope[] = [module];
    const scopeOfNode = new Map<number, GScope>([[0, module]]);
    // The innermost scope around each node, from the nearest ancestor that opens one.
    const enclosing = new Int32Array(t.count);
    for (let n = 1; n < t.count; n++) {
        const kind = rules.scope(t, n);
        if (!kind) {
            enclosing[n] = rules.outside?.(t, n) ? (scopes[enclosing[t.parent[n]]].parent?.id ?? 0) : enclosing[t.parent[n]];
            continue;
        }
        const s: GScope = { id: scopes.length, node: n, kind, parent: scopes[enclosing[t.parent[n]]], names: new Map() };
        scopes.push(s);
        scopeOfNode.set(n, s);
        enclosing[n] = s.id;
    }
    const scopeAt = (n: number): GScope => scopes[enclosing[n]];
    const outerScopeAt = (n: number): GScope => {
        const s = scopeAt(n);
        return s.node === n ? (s.parent ?? module) : s;
    };
    const functionScopeOf = (s: GScope): GScope => {
        let x: GScope | null = s;
        while (x && x.kind !== "function" && x.kind !== "module") x = x.parent;
        return x ?? module;
    };

    // Bindings, in tree order. A name token that binds is no reference, except after `global` or `nonlocal`.
    const bindingNodes = new Set<number>();
    for (let n = 1; n < t.count; n++) {
        rules.binds(t, n, (nameNode, kind, opts = {}) => {
            const name = opts.name ?? textOf(t, nameNode);
            if (!name) return;
            if (kind !== "global" && kind !== "nonlocal") bindingNodes.add(nameNode);
            let scope = kind === "def" || kind === "type" ? outerScopeAt(opts.unitNode ?? t.parent[nameNode]) : scopeAt(nameNode);
            if (opts.to === "function") scope = functionScopeOf(scope);
            if (opts.to === "module") scope = module;
            // After `global x`, x binds at module level (Python).
            if (kind !== "global" && scope !== module && functionScopeOf(scope).names.get(name)?.some((b) => b.kind === "global")) scope = module;
            const unit = opts.unitNode !== undefined ? unitByNode.get(opts.unitNode) : undefined;
            const b: GBinding = {
                name,
                node: nameNode,
                kind,
                scope,
                ...(unit ? { unit } : {}),
                ...(opts.import ? { import: opts.import } : {}),
                ...(opts.typeNode !== undefined && opts.typeNode >= 0 ? { typeNode: opts.typeNode } : {}),
                ...(opts.init !== undefined && opts.init >= 0 ? { init: opts.init } : {}),
                ...(opts.initResult !== undefined ? { initResult: opts.initResult } : {}),
                // A module's names are seen in the whole module: Go's package-level `var`.
                ...(opts.from !== undefined && scope !== module ? { from: opts.from } : {}),
            };
            const list = scope.names.get(name);
            if (list) list.push(b);
            else scope.names.set(name, [b]);
        });
    }
    // A function that declares `nonlocal x` writes the x of the function around it that binds x (Python): its writes join that x's bindings.
    for (const s of scopes) {
        for (const [name, bs] of s.names) {
            if (!bs.some((b) => b.kind === "nonlocal")) continue;
            const writes = bs.filter((b) => b.kind !== "nonlocal" && b.kind !== "global");
            let target = s.parent;
            while (target && !(target.kind === "function" && target.names.get(name)?.some((b) => b.kind !== "nonlocal" && b.kind !== "global"))) target = target.parent;
            if (!target || writes.length === 0) continue;
            s.names.set(
                name,
                bs.filter((b) => !writes.includes(b))
            );
            for (const b of writes) {
                b.scope = target;
                target.names.get(name)!.push(b);
            }
        }
    }

    // Class members: the units directly inside a class-like unit.
    const members = new Map<string, Members>();
    const bases = new Map<string, number[]>();
    for (const u of units) {
        const cls = rules.classOf?.(t, u.node);
        if (!cls) continue;
        bases.set(u.id, cls.bases);
        members.set(u.id, new Map());
    }
    for (const u of units) {
        const m = u.parent ? members.get(u.parent) : undefined;
        if (!m) continue;
        const named = m.get(u.name);
        if (named) named.push(u);
        else m.set(u.name, [u]);
    }

    // Sites: every identifier that may refer to a declaration.
    const imports = rules.imports(t);
    const importNodes = new Set(imports.map((i) => i.node));
    const sites: GSite[] = [];
    for (let n = 0; n < t.count; n++) {
        if (!rules.identifiers.has(t.type[n]) || bindingNodes.has(n) || importNodes.has(n)) continue;
        const role = rules.role(t, n);
        if (role.kind === "decl" || role.kind === "skip") continue;
        sites.push({
            node: n,
            start: t.start[n],
            line: lineOf(t, t.start[n]),
            name: textOf(t, n),
            shape: role.kind,
            receiver: role.kind === "bare" ? -1 : role.receiver,
            ref: rules.isCallee(t, role.expr) ? "call" : rules.isType(t, n) ? "type" : "value",
            scope: scopeAt(n),
        });
    }
    // An import of a name refers to it: `from x import f`, `use a::f`.
    for (const i of imports) {
        if (i.name === null || i.name === "*" || i.node < 0) continue;
        sites.push({ node: i.node, start: t.start[i.node], line: lineOf(t, t.start[i.node]), name: i.name, shape: "bare", receiver: -1, ref: "import", scope: scopeAt(i.node) });
    }
    const importScope = new Map(imports.map((i) => [i, scopeAt(i.stmt)]));
    return { path, rules, flat: t, units, labels, module, scopes, scopeOfNode, enclosing, sites, imports, importScope, members, bases, unitByNode };
};
