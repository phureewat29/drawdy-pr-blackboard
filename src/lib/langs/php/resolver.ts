/**
 * PHP's resolver: what each site names, through the resolution's program
 * (`program.ts`). A method call names the method its receiver's class
 * reaches, `new` the class and the constructor it runs, a class name its
 * class, and a `use` import the class it brings. A function call names
 * nothing: a namespace's call may fall back to a global function at run
 * time, and only a `files` autoload or a `require` loads a function's file.
 * A file the parser read with errors names nothing: a gap may hide a `use`,
 * a namespace or a write.
 */

import type { GSite } from "../../anyfacts.ts";
import type { Named, OwnResolver } from "../../anylink.ts";
import type { Unit } from "../pack.ts";
import { nameText } from "./nodes.ts";
import { spaceAt } from "./outline.ts";
import { createProgram, type PFile, type Program } from "./program.ts";
import { siteNode } from "./rules.ts";

const named = (u: Unit | undefined, ref: GSite["ref"]): Named => (u ? [{ ref, units: [u] }] : []);

const resolveSite = (p: Program, pf: PFile, s: GSite): Named => {
    const t = pf.t;
    if (s.ref === "import") return named(p.classByName(pf, spaceAt(pf.o, s.start).uses.find((u) => u.node === s.node)?.target ?? "")?.unit, s.ref);
    const e = siteNode(t, s.node);
    const host = t.parent[e];
    if (t.field[e] === "name") {
        const c = p.callOf(pf, host);
        return named(c?.r.owner.file.f.unitByNode.get(c.r.m.node), s.ref);
    }
    if (t.field[e] === "function") return [];
    // `self`, `static` and `parent` name the class the code is in, or its parent: no line of their own.
    const special = /^(self|static|parent)$/i.test(nameText(t, e));
    if (t.type[host] !== "object_creation_expression") return special ? [] : named(p.classAt(pf, e)?.unit, s.ref);
    // `new C(…)`: the class, and the constructor it runs; its class's card stands for it where it has none.
    const c = p.createdAt(pf, host);
    const ctor = c && p.constructorOf(c, p.scopeOf(pf, host));
    const u = ctor && ("m" in ctor ? ctor.owner.file.f.unitByNode.get(ctor.m.node) : ctor.unit);
    return [...(special ? [] : named(c?.unit, "type")), ...(u ? [{ ref: "call" as const, units: [u], ...(u !== c!.unit && c!.unit && { alt: c!.unit }) }] : [])];
};

const program: OwnResolver["program"] = (files, ctx) => {
    const p = createProgram(files, ctx);
    return (f, s) => (f.flat.errors === 0 ? resolveSite(p, p.pfileOf(f), s) : []);
};

export const PHP_RESOLVER: OwnResolver = { program };

/** Every site of a changed file resolved, for what the reads must fetch (`wants.ts`). */
export const resolveAll = (p: Program, f: Parameters<Program["pfileOf"]>[0]): void => {
    if (f.flat.errors === 0) for (const s of f.sites) resolveSite(p, p.pfileOf(f), s);
};
