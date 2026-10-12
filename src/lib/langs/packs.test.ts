import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { testParse } from "../../test/parser.ts";
import { languageOf, languageOfFence } from "../language.ts";
import { linkerOf } from "../linking.ts";
import { sha256 } from "../sha256.ts";
import { PACKS } from "./index.ts";
import { LINKERS } from "./linkers.ts";

const NODE_MODULES = join(import.meta.dirname, "../../../node_modules");
const devDependencies: Record<string, string> = JSON.parse(readFileSync(join(import.meta.dirname, "../../../package.json"), "utf8")).devDependencies;
const grammars = PACKS.flatMap((p) => (p.grammars ?? []).map((g) => ({ pack: p, ...g })));

describe("the packs", () => {
    it("each have their own id, extensions and fence names", () => {
        const ids = PACKS.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).not.toContain("text");
        const extensions = PACKS.flatMap((p) => p.extensions);
        expect(new Set(extensions).size).toBe(extensions.length);
        for (const p of PACKS) {
            for (const e of p.extensions) expect([e, languageOf(`a.${e}`)]).toEqual([e, p.id]);
            for (const f of p.fences ?? []) expect([f, languageOfFence(f)]).toEqual([f, p.id]);
        }
    });

    it("each pin a grammar of their own extensions to an exact devDependency and its wasm's SHA-256", () => {
        const names = grammars.map((g) => g.name);
        expect(new Set(names).size).toBe(names.length);
        const parsed = grammars.flatMap((g) => g.extensions);
        expect(new Set(parsed).size).toBe(parsed.length);
        for (const g of grammars) {
            expect(g.extensions.every((e) => g.pack.extensions.includes(e))).toBe(true);
            expect([g.package, devDependencies[g.package]]).toEqual([g.package, g.version]);
            expect([g.name, sha256(new Uint8Array(readFileSync(join(NODE_MODULES, g.package, g.file))))]).toEqual([g.name, g.sha256]);
        }
    });

    it("give line patterns whose name and owner groups exist", () => {
        for (const p of PACKS) {
            for (const pattern of p.lines?.patterns ?? []) {
                const groups = new RegExp(`${pattern.re.source}|`).exec("")!.length - 1;
                expect([p.id, pattern.re.source, Math.max(pattern.group ?? 1, pattern.owner ?? 0) <= groups]).toEqual([p.id, pattern.re.source, true]);
            }
        }
    });
});

describe("the linkers", () => {
    it("read every pack that has a grammar, one linker each, and only packs listed", () => {
        for (const p of PACKS) expect([p.id, LINKERS.filter((l) => l.packs.includes(p)).length]).toEqual([p.id, p.grammars ? 1 : 0]);
        for (const l of LINKERS) for (const p of l.packs) expect(PACKS).toContain(p);
    });

    it("query units with each grammar's own tags.scm, unchanged, where its package ships one", () => {
        for (const l of LINKERS) {
            if (l.kind !== "rules") continue;
            const g = l.packs[0].grammars![0];
            const tags = join(NODE_MODULES, g.package, "queries/tags.scm");
            if (existsSync(tags)) expect([g.name, l.units]).toEqual([g.name, readFileSync(tags, "utf8")]);
        }
    });

    it("leave a language with no linker to its line patterns: its files parse to nothing, so they make no link", async () => {
        expect([linkerOf("lib/a.rb"), await testParse("lib/a.rb", "class A\n  def run\n    helper\n  end\nend\n")]).toEqual([undefined, null]);
        expect(linkerOf("src/a.py")).toBeDefined();
    });
});
