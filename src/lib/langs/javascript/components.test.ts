import { beforeAll, describe, expect, it } from "@jest/globals";
import { testParse, testSyntax } from "../../../test/parser.ts";
import type { PrFile, PrInfo } from "../../github.ts";
import { linkAll } from "../../linking.ts";
import { readSources } from "../../sources.ts";
import type { Syntax } from "../../syntax.ts";
import { blocksText, componentOf, type Component } from "./components.ts";
import { parseFacts, type FileFacts } from "./facts.ts";
import { resolveAll } from "./resolve.ts";

let syntax: Syntax;
beforeAll(async () => {
    syntax = await testSyntax();
});

/** A component's blocks as their code, `inner` marked, with its grammar; null when it isn't read. */
const blocks = (path: string, lines: string[]) => {
    const text = lines.join("\n");
    const c = componentOf(path, text);
    return c && { grammar: c.grammar, code: c.blocks.map((b) => `${b.inner ? "inner" : "outer"}: ${text.slice(b.start, b.end).trim()}`), generics: c.generics };
};

describe("a Vue component's blocks", () => {
    it("are its top-level <script> and <script setup>, at their own offsets, in its tag's language, wherever its template sits", () => {
        expect(blocks("A.vue", ["<template>", "  <div @click='save'>{{ n }}</div>", "</template>", "", '<script setup lang="ts">', "const n = 1", "</script>"])).toEqual({
            grammar: "typescript",
            code: ["inner: const n = 1"],
            generics: [],
        });
        expect(blocks("A.vue", ["<script>", "export default { name: 'A' }", "</script>", "<script setup>", "import B from './B.vue'", "</script>", "<style scoped>.a {}</style>"])).toEqual({
            grammar: "javascript",
            code: ["outer: export default { name: 'A' }", "inner: import B from './B.vue'"],
            generics: [],
        });
        expect(blocks("A.vue", ['<script setup lang="tsx">', "const a = <div />", "</script>"])?.grammar).toBe("tsx");
        expect(blocks("A.vue", ['<script lang="jsx">', "const a = 1", "</script>"])?.grammar).toBe("javascript");
        expect(blocks("A.vue", ['<script setup lang="ts" generic="T extends Record<string, U>, const K = keyof T">', "defineProps<{ a: T }>()", "</script>"])?.generics).toEqual(["T", "K"]);
    });

    it("are found past a template read as HTML: nested templates, a closing tag closing those it holds, quotes, comments and {{ }}", () => {
        const found = blocks("A.vue", [
            "<template>",
            "  <div :title=\"a > b ? '</template>' : ''\">",
            "    <template v-if='x'><span></template>",
            "    <section><template #slot></section>",
            "    <!-- </template> -->",
            "    {{ '</template>' }}",
            "    <Title><b>bold</b></Title>",
            "    <input><br/>",
            "  </div>",
            "</template>",
            "<script setup>",
            "const a = 1",
            "</script>",
        ]);
        expect(found?.code).toEqual(["inner: const a = 1"]);
        expect(blocks("A.vue", ["<template><textarea>{{ a }}</textarea></template>", "<script>", "const a = 1", "</script>"])?.code).toEqual(["outer: const a = 1"]);
    });

    it("end at </script> in any case, as an HTML parser ends them: inside a string, which leaves a stray tag and the file unread", () => {
        expect(blocks("A.vue", ["<script>", "const a = 1", "</SCRIPT >"])?.code).toEqual(["outer: const a = 1"]);
        expect(blocks("A.vue", ["<script>", "const s = '</script>'", "</script>"])).toBeNull();
    });

    it("leave a file to line patterns when they can't be read cleanly", () => {
        const unread = [
            ["<template><div>", "<script>", "const a = 1", "</script>"],
            ["<template><script>a()</script></template>", "<script>", "const a = 1", "</script>"],
            ["<template><pre v-pre>{{ </pre></template>", "<script>", "const a = 1", "</script>"],
            ["<template><style>.a {}</style></template>", "<script>", "const a = 1", "</script>"],
            ["<template><textarea><b></textarea></template>", "<script>", "const a = 1", "</script>"],
            ["<script setup>", "const a = 1", "</script>", "<script setup>", "const b = 1", "</script>"],
            ["<script>", "const a = 1", "</script>", "<script>", "const b = 1", "</script>"],
            ['<script lang="ts">', "const a = 1", "</script>", "<script setup>", "const b = 1", "</script>"],
            ['<script lang="coffee">', "a = 1", "</script>"],
            ['<script src="./a.ts"></script>', "<script setup>", "const b = 1", "</script>"],
            ['<script setup lang="ts" name="A">', "const a = 1", "</script>"],
            ['<script setup="props">', "const a = 1", "</script>"],
            ['<script generic="T">', "const a = 1", "</script>"],
            ['<script setup generic="T extends A<B">', "const a = 1", "</script>"],
            ['<script lang="t&#115;">', "const a = 1", "</script>"],
            ["<SCRIPT>", "const a = 1", "</SCRIPT>"],
            ["</div>", "<script>", "const a = 1", "</script>"],
            ["<script / >", "const a = 1", "</script>"],
            ["<script>", "const a = 1"],
            ["{{ <script>", "const a = 1", "</script>"],
            ["<script>", "const a = '\u0001'", "</script>"],
        ];
        for (const lines of unread) expect([lines.join("⏎"), componentOf("A.vue", lines.join("\n"))]).toEqual([lines.join("⏎"), null]);
    });

    it("are none in a template-only component, which is still read", () => {
        expect(blocks("A.vue", ["<template><p>{{ $t('hi') }}</p></template>"])).toEqual({ grammar: "typescript", code: [], generics: [] });
    });
});

describe("a Svelte component's blocks", () => {
    it("are its instance and module scripts before any markup, comments and static <svelte:options> aside", () => {
        expect(blocks("A.svelte", ["<svelte:options runes />", "<!-- docs -->", '<script module lang="ts">', "export const shared = 1", "</script>", "", '<script lang="ts">', "let n = $state(0)", "</script >", "", "<p>{n}</p>"])).toEqual({
            grammar: "typescript",
            code: ["outer: export const shared = 1", "inner: let n = $state(0)"],
            generics: [],
        });
        expect(blocks("A.svelte", ['<script context="module">', "export const a = 1", "</script>", "<script>", "export let b = 2", "</script>"])?.code).toEqual(["outer: export const a = 1", "inner: export let b = 2"]);
        // Svelte reads every script as TypeScript when the first that names a language says ts.
        expect(blocks("A.svelte", ["<script module>", "export const a: number = 1", "</script>", '<script lang="ts">', "let b = 2", "</script>"])?.grammar).toBe("typescript");
        expect(blocks("A.svelte", ['<script lang="ts" generics="T extends { id: string }">', "let { items }: { items: T[] } = $props()", "</script>"])?.generics).toEqual(["T"]);
    });

    it("leave a file to line patterns when a script could sit inside markup or its tag says what these rules don't take", () => {
        const unread = [
            ["<p>hi</p>", "<script>", "let a = 1", "</script>"],
            ["<script>", "let a = 1", "</script>", "<svelte:head><script type='application/ld+json'>{}</script></svelte:head>"],
            ["<script>", "let s = '<script>'", "</script>"],
            ['<script type="text/typescript">', "let a = 1", "</script>"],
            ['<script lang="js">', "let a = 1", "</script>"],
            ["<script>", "let a = 1", "</script>", "<script>", "let b = 1", "</script>"],
            ['<script module generics="T">', "let a = 1", "</script>"],
            ["<script>", "let a = 1"],
            ["<style>p {}</style>", "<script>", "let a = 1", "</script>"],
        ];
        for (const lines of unread) expect([lines.join("⏎"), componentOf("A.svelte", lines.join("\n"))]).toEqual([lines.join("⏎"), null]);
    });

    it("are none in a markup-only component, and other files are no component", () => {
        expect(blocks("A.svelte", ["<h1>{title}</h1>"])).toEqual({ grammar: "typescript", code: [], generics: [] });
        expect(componentOf("a.ts", "<script></script>")).toBeUndefined();
    });
});

describe("the text a component is parsed as", () => {
    it("keeps its blocks and line breaks at their offsets, blanks the rest, and ends a block another follows with `;`", () => {
        const text = "<script>\nconst a = 1\n</script>\n<template>\n  <p>{{ a }}</p>\n</template>\n<script setup>\nf()\n</script>\n";
        const parsed = blocksText(text, componentOf("A.vue", text) as Component);
        expect(parsed.length).toBe(text.length);
        expect(parsed.split("\n")).toEqual(["        ", "const a = 1", ";        ", "          ", "                ", "           ", "              ", "f()", "         ", ""]);
    });
});

const facts = (path: string, lines: string[]): FileFacts | null => parseFacts(syntax, path, lines.join("\n"));

/** Each reference in `from` as `line name → unit ids`, the files all read and changed. */
const refs = (files: Record<string, string[]>, from: string): string[] => {
    const all = Object.entries(files).map(([path, lines]) => facts(path, lines)!);
    const names = new Map(all.flatMap((f) => f.sites.map((s) => [`${f.path}:${s.start}`, s.name] as const)));
    return resolveAll(all, new Set(Object.keys(files)), { paths: () => [], builtin: () => null })
        .filter((r) => r.path === from)
        .map((r) => `${r.line} ${names.get(`${r.path}:${r.start}`)} → ${r.units.map((u) => u.id).join(" ")}`);
};

describe("a component's units", () => {
    it("are the declarations of its blocks at their own lines, and the component itself, its file whole, named as its file", () => {
        const f = facts("src/Card.vue", ["<template>", "  <p>{{ label() }}</p>", "</template>", "", '<script setup lang="ts">', "const props = defineProps<{ n: number }>()", "function label() {", "  return String(props.n)", "}", "</script>", ""])!;
        expect(f.units.map((u) => `${u.id} ${u.kind} ${u.name} ${u.startLine}-${u.endLine}`)).toEqual(["src/Card.vue:6 value props 6-6", "src/Card.vue:7 function label 7-9", "src/Card.vue:1 value Card.vue 1-10"]);
        expect(f.component?.unit.start).toBe(0);
    });

    it("take its outer block's `export default {…}` for its own: no card of its own, its functions and their groups (`methods: {…}`) the component's", () => {
        const f = facts("src/A.vue", ["<script>", "export default {", "  name: 'A',", "  setup() { return {} },", "  methods: { save() {}, load: function () {} },", "  computed: { total() { return 1 } },", "}", "</script>", "<template><p /></template>"])!;
        expect(f.units.map((u) => `${u.id} ${u.name} ${u.parent ?? "-"}`)).toEqual([
            "src/A.vue:4 setup src/A.vue:1",
            "src/A.vue:5 methods src/A.vue:1",
            "src/A.vue:5:save save src/A.vue:5",
            "src/A.vue:5:load load src/A.vue:5",
            "src/A.vue:6 computed src/A.vue:1",
            "src/A.vue:6:total total src/A.vue:6",
            "src/A.vue:1 A.vue -",
        ]);
    });

    it("are none when its statements run across its blocks or its blocks have any syntax error", () => {
        expect(facts("A.vue", ["<script>", "const a = `", "</script>", "<script setup>", "const b = `", "</script>"])).toBeNull();
        expect(facts("A.vue", ["<template><p>a long template that makes the code a small share of the file</p></template>", "<script>", "const = = 1", "</script>"])).toBeNull();
        // TypeScript in a block without `lang`, which a preprocessor may take for TypeScript: read as JavaScript, it has errors.
        const filler = Array.from({ length: 80 }, (_, i) => `function f${i}(x) { return x + ${i} }`);
        expect(facts("B.svelte", ["<script>", ...filler, "function g(item: number) { return item }", "</script>"])).toBeNull();
        expect(facts("B.svelte", ["<script>", ...filler, "function g(item) { return item }", "</script>"])).not.toBeNull();
    });
});

describe("a component's names", () => {
    it("reach from <script setup> to the other block and to every import; the other block sees neither <script setup>'s declarations nor a name both declare", () => {
        const files = {
            "util.ts": ["export function helper() {}", "export function format() {}"],
            "A.vue": [
                "<script>",
                "import { helper } from './util'",
                "export function outer() { return inner() + format() }",
                "</script>",
                "<script setup>",
                "import { format } from './util'",
                "function inner() { return outer() + helper() + format() }",
                "</script>",
            ],
        };
        expect(refs(files, "A.vue")).toEqual(["2 helper → util.ts:1", "3 format → util.ts:2", "6 format → util.ts:2", "7 outer → A.vue:3", "7 helper → util.ts:1", "7 format → util.ts:2"]);
        expect(facts("B.vue", ["<script>", "const a = 1", "</script>", "<script setup>", "const a = 2", "</script>"])).toBeNull();
        expect(facts("B.vue", ["<script>", "import { a } from './x'", "</script>", "<script setup>", "function a() {}", "</script>"])).toBeNull();
    });

    it("leave a <script setup generic> parameter to the setup block: its name there names nothing", () => {
        const files = { "A.vue": ["<script lang='ts'>", "export interface T { id: string }", "export function f(t: T) {}", "</script>", "<script setup lang='ts' generic='T'>", "const x: T = null!", "</script>"] };
        expect(refs(files, "A.vue")).toEqual(["3 T → A.vue:2"]);
    });

    it("draw nothing for Vue's compiler macros, and nothing through `this` in a component's options", () => {
        const files = {
            "A.vue": [
                "<script>",
                "import { defineComponent } from 'vue'",
                "export default defineComponent({",
                "  methods: { save() { this.load() }, load() {} },",
                "  mounted() { this.save() },",
                "  save() {},",
                "})",
                "</script>",
            ],
            "B.vue": ["<script setup lang='ts'>", "const props = withDefaults(defineProps<{ n?: number }>(), { n: 1 })", "const emit = defineEmits<{ go: [] }>()", "const model = defineModel()", "defineExpose({})", "defineOptions({ name: 'B' })", "defineSlots()", "</script>"],
            "C.vue": ["<script setup>", "import { defineProps } from './macros'", "function withDefaults() {}", "const props = withDefaults(defineProps())", "</script>"],
            "macros.ts": ["export function defineProps() {}"],
        };
        expect(refs(files, "A.vue")).toEqual([]);
        expect(refs(files, "B.vue")).toEqual([]);
        // Even a name a macro shares with an import or a declaration: the compiler takes the call.
        expect(refs(files, "C.vue")).toEqual(["2 defineProps → macros.ts:1"]);
    });

    it("take a variable a call builds for unknown in a component: `withDefaults` gives no default's factory for a prop", () => {
        const files = {
            "A.vue": [
                "<script setup lang='ts'>",
                "const props = withDefaults(defineProps<{ options?: string[]; label?: string }>(), { options: () => [], label: 'x' })",
                "const shown = props.options.length + props.label.length",
                "</script>",
            ],
        };
        expect(facts("A.vue", files["A.vue"])!.units.map((u) => u.name)).toEqual(["props", "shown", "A.vue"]);
        expect(refs(files, "A.vue")).toEqual(["3 props → A.vue:2", "3 props → A.vue:2"]);
    });

    it("draw nothing for Svelte's runes, even beside a store of a rune's name", () => {
        const files = {
            "s.ts": ["export const state = 1"],
            "A.svelte": ["<script>", "import { state } from './s'", "let a = $state(0)", "const b = $derived(a * 2)", "$effect(() => {})", "let { c } = $props()", "</script>"],
        };
        expect(refs(files, "A.svelte")).toEqual(["2 state → s.ts:1", "4 a → A.svelte:3"]);
    });

    it("take a Svelte `$store` for the store its instance script's top level names, unless a nearer name hides it, in its module script, or for `$$props`", () => {
        const files = {
            "stores.ts": ["export const count = 1", "export const user = 2"],
            "A.svelte": [
                "<script module>",
                "import { user } from './stores'",
                "export function m() { return $user }",
                "</script>",
                "<script>",
                "import { count } from './stores'",
                "const shown = $count + $user + $$props.a + $missing",
                "function f(count) { return $count }",
                "</script>",
            ],
        };
        expect(refs(files, "A.svelte")).toEqual(["2 user → stores.ts:2", "6 count → stores.ts:1", "7 $count → stores.ts:1", "7 $user → stores.ts:2"]);
    });
});

describe("a Svelte component's types", () => {
    it("leave Svelte 4's `$$Generic` type parameters to no card, and a callback type's parameter names to no declaration", () => {
        const files = { "A.svelte": ['<script lang="ts">', "type T = $$Generic<string>", "type $$Props = { items: T[]; onClose: (settings?: number) => void }", "export let items: $$Props['items']", "let settings = $state(1)", "</script>"] };
        expect(facts("A.svelte", files["A.svelte"])!.units.map((u) => u.name)).toEqual(["$$Props", "items", "settings", "A.svelte"]);
        expect(refs(files, "A.svelte")).toEqual(["4 $$Props → A.svelte:3"]);
    });
});

describe("importing a component", () => {
    it("names the component for its default export, and only its outer block's exports by name", () => {
        const files = {
            "Button.vue": ["<script>", "export const sizes = ['s']", "export default { name: 'B' }", "</script>", "<script setup>", "const local = 1", "</script>"],
            "Item.svelte": ["<script module>", "export const kinds = 1", "</script>", "<script>", "export let label = ''", "export function focus() {}", "</script>"],
            "app.ts": ["import Button, { sizes } from './Button.vue'", "import Item, { kinds, label, focus } from './Item.svelte'", "export const all = [Button, sizes, Item, kinds, label, focus]"],
        };
        expect(refs(files, "app.ts")).toEqual([
            "1 Button → Button.vue:1",
            "1 sizes → Button.vue:2",
            "2 Item → Item.svelte:1",
            "2 kinds → Item.svelte:2",
            "3 Button → Button.vue:1",
            "3 sizes → Button.vue:2",
            "3 Item → Item.svelte:1",
            "3 kinds → Item.svelte:2",
        ]);
    });

    it("is followed by the read tier: a changed component's imports are read, an import of one from TypeScript too", async () => {
        const repo: Record<string, string> = {
            "src/Page.vue": "<script setup lang='ts'>\nimport Card from './Card.vue'\nimport { load } from './load'\nload()\n</script>\n<template><Card /></template>\n",
            "src/Card.vue": "<template><p /></template>\n",
            "src/load.ts": "export function load() {}\n",
            "src/main.ts": "import Page from './Page.vue'\nexport default Page\n",
        };
        const changed = (path: string): PrFile => ({ path, status: "modified", additions: 1, deletions: 0, patch: "@@ -1,1 +1,1 @@\n+x" });
        const asked: string[] = [];
        const sources = await readSources([changed("src/Page.vue"), changed("src/main.ts")], async (path) => (asked.push(path), repo[path] ?? null), testParse);
        expect([...sources.facts.keys()]).toEqual(["src/Page.vue", "src/main.ts", "src/Card.vue", "src/load.ts"]);
        expect(asked.filter((p) => p.includes("Card"))).toEqual(["src/Card.vue"]);
    });

    it("names the component even with its declaration file beside it: lines go to the code that runs", () => {
        const files = {
            "A.svelte": ["<script>", "export function a() {}", "</script>"],
            "A.svelte.d.ts": ["export default class A {}"],
            "B.vue": ["<script>", "export default {}", "</script>"],
            "B.vue.d.ts": ["export default class B {}"],
            "app.ts": ["import A from './A.svelte'", "import B from './B.vue'", "export const all = [A, B]"],
        };
        expect(refs(files, "app.ts")).toEqual(["1 A → A.svelte:1", "2 B → B.vue:1", "3 A → A.svelte:1", "3 B → B.vue:1"]);
    });

    it("is read in the order its candidates resolve in: one already read counts only once those before it are missing", async () => {
        const repo: Record<string, string> = {
            "src/Counter.svelte": "<script module>\nexport function count() { return 1 }\n</script>\n",
            "src/Counter.svelte.ts": "export function count() { return 2 }\n",
            "src/use.ts": "import { count } from './Counter.svelte'\nexport const v = count()\n",
        };
        const changed = (path: string): PrFile => ({ path, status: "modified", additions: 1, deletions: 0, patch: "@@ -1,1 +1,1 @@\n+x" });
        const pr = { ref: { owner: "o", repo: "r", number: 1 } } as PrInfo;
        const files = [changed("src/use.ts"), changed("src/Counter.svelte.ts")];
        const link = async (texts: Record<string, string>) => {
            const sources = await readSources(files, async (path) => texts[path] ?? null, testParse);
            return linkAll(pr, new Set(files.map((f) => f.path)), sources)
                .filter((r) => r.path === "src/use.ts")
                .map((r) => `${r.line} ${r.units.map((u) => u.id).join(" ")}`);
        };
        expect(await link(repo)).toEqual(["1 src/Counter.svelte:2", "2 src/Counter.svelte:2"]);
        // A component it can't parse names nothing, not the module after it.
        expect(await link({ ...repo, "src/Counter.svelte": "<script module>\nexport function count() {\n" })).toEqual([]);
    });
});
