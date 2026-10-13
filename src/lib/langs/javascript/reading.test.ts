import { describe, expect, it } from "@jest/globals";
import { testParse } from "../../../test/parser.ts";
import type { PrFile, PrInfo } from "../../github.ts";
import { linkAll } from "../../linking.ts";
import { readSources } from "../../sources.ts";

const pr = { ref: { owner: "o", repo: "r", number: 1 } } as PrInfo;
const changedFile = (path: string): PrFile => ({ path, status: "modified", additions: 1, deletions: 0, patch: "@@ -1,1 +1,1 @@\n+x" });

/** What a PR changing `changed` reads, in order, and the lines from `from`, as `line → unit ids`. */
const board = async (repo: Record<string, string>, changed: string[], from: string) => {
    const asked: string[] = [];
    const files = changed.map(changedFile);
    const sources = await readSources(files, async (path) => (asked.push(path), repo[path] ?? null), testParse);
    const lines = linkAll(pr, new Set(changed), sources)
        .filter((r) => r.path === from)
        .map((r) => `${r.line} → ${r.units.map((u) => u.id).join(" ")}`);
    return { asked, lines };
};

describe("an import the board follows", () => {
    it("takes the JavaScript beside a declaration file found first, asking for it next: lines go to the code that runs", async () => {
        const repo = {
            "src/legacy.js": "export function helper() {}\n",
            "src/legacy.d.ts": "export declare function helper(): number;\n",
            "src/plugin/index.js": "export default function plugin() {}\n",
            "src/plugin/index.d.ts": "export default function plugin(): number;\n",
            "src/app.ts": "import { helper } from './legacy'\nimport plugin from './plugin'\nhelper()\nplugin()\n",
        };
        const { asked, lines } = await board(repo, ["src/app.ts"], "src/app.ts");
        expect(asked.filter((p) => p.startsWith("src/legacy"))).toEqual(["src/legacy.ts", "src/legacy.tsx", "src/legacy.d.ts", "src/legacy.js"]);
        expect(lines).toEqual(["1 → src/legacy.js:1", "2 → src/plugin/index.js:1", "3 → src/legacy.js:1", "4 → src/plugin/index.js:1"]);
    });
});

describe("an import the board reads but doesn't follow", () => {
    it("names a candidate only once those before it are known missing", async () => {
        const repo = {
            "src/lib/Card.svelte": "<script lang='ts'>\nexport let title = ''\n</script>\n",
            "src/lib/Card.svelte.d.ts": "export default class Card {}\n",
            "src/lib/x.ts": "export function make() {}\n",
            "src/lib/x/index.ts": "export function make() {}\n",
            "src/lib/Counter.svelte": "<script lang='ts' module>\nexport function count() {}\n</script>\n",
            "src/lib/Counter.svelte.ts": "export function count() {}\n",
            "src/lib/index.ts": "export { default as Card } from './Card.svelte'\nexport { make } from './x'\nexport { count } from './Counter.svelte'\n",
            "src/app.ts": "import { Card, make, count } from './lib'\nexport const all = [Card, make(), count()]\n",
        };
        // The barrel is read for app.ts; the files its re-exports name are the PR's own, later candidates than ones never asked for.
        const { lines } = await board(repo, ["src/app.ts", "src/lib/Card.svelte.d.ts", "src/lib/x/index.ts", "src/lib/Counter.svelte.ts"], "src/lib/index.ts");
        expect(lines).toEqual([]);
    });

    it("takes a parsed `x.ts` for `./x.js` never asked for, as TypeScript reads the specifier", async () => {
        const repo = {
            "source/core.ts": "export class Ky {}\n",
            "source/index.ts": "export { Ky } from './core.js'\n",
            "test/main.ts": "import { Ky } from '../source/index.js'\nexport const k = new Ky()\n",
        };
        const { lines } = await board(repo, ["test/main.ts", "source/core.ts"], "source/index.ts");
        expect(lines).toEqual(["1 → source/core.ts:1"]);
    });

    it("maps each JavaScript extension to its own TypeScript one: `.mjs` to `.mts`, `.cjs` to `.cts`, `.jsx` to `.tsx`", async () => {
        const repo = {
            "src/util.ts": "export function helper() {}\n",
            "src/util.mts": "export function helper() {}\n",
            "src/Button.ts": "export function Button() {}\n",
            "src/Button.tsx": "export function Button() {}\n",
            "src/index.ts": "export { helper } from './util.mjs'\nexport { Button } from './Button.jsx'\n",
            "src/app.ts": "import { helper, Button } from './index.js'\nexport const all = [helper, Button]\n",
        };
        // util.mts and Button.tsx, never asked for, come before the PR's util.ts and Button.ts.
        const { lines } = await board(repo, ["src/app.ts", "src/util.ts", "src/Button.ts"], "src/index.ts");
        expect(lines).toEqual([]);
    });
});
