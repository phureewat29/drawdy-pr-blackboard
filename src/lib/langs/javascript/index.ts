/**
 * TypeScript and JavaScript: two packs, for their own extensions, grammars
 * and keywords, which share their line patterns and one linker (`linker.ts`),
 * since a TypeScript file imports JavaScript ones and the other way round.
 * `.vue` and `.svelte` files read as JavaScript by line patterns alone.
 */

import { C_LIKE } from "../c-family.ts";
import type { CaseRule, LanguagePack, Lines } from "../pack.ts";

/** Classes, types (not `type X,` inside a multi-line import), functions, top-level values, and the members of a class. */
const JS_LINES: Lines = {
    patterns: [
        { re: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class", container: true },
        { re: /^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)(?=\s*(?:[=<{]|extends\b|$))/, kind: "type" },
        { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: "function" },
        { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s+)?(?:function\b|\(|<|[A-Za-z_$][\w$]*\s*=>)/, kind: "function" },
        { re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, kind: "value", topOnly: true },
        { re: /^\s+(?:(?:public|private|protected|static|readonly|override|abstract|declare)\s+)*(#?[A-Za-z_$][\w$]*)\s*(?:\?|!)?\s*(?::[^=]*)?=\s*(?:async\s+)?(?:\(|[A-Za-z_$][\w$]*\s*=>|function\b)/, kind: "method", inClassOnly: true },
        { re: /^\s+(?:(?:public|private|protected|static|readonly|override|declare)\s+)*(#?[A-Za-z_$][\w$]*)\s*[?!]?\s*:\s*\(\s*$/, kind: "method", inClassOnly: true, arrowField: true },
        { re: /^\s+(?:(?:public|private|protected|static|readonly|async|override|abstract|get|set)\s+)*\*?\s*(#?[A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/, kind: "method", inClassOnly: true },
    ],
};

const CASE = /\b(describe|context|suite|it|test|specify)(?:\.(?:each|only|skip|concurrent|todo)(?:\([^)]*\))?)*\(\s*(['"`])(.+?)\2/;

/** `describe("…")`, `it("…")` and their `.each`, `.only` and `.skip`; `it.each([...])(` names its case on the next line. */
const jsCase: CaseRule = (line, next) => {
    const m = CASE.exec(line);
    if (m) return { name: m[3], group: /^(describe|context|suite)$/.test(m[1]) };
    if (!/\b(it|test)\.each\(.*\)\(\s*$/.test(line)) return undefined;
    const named = /^\s*(['"`])(.+?)\1/.exec(next ?? "");
    return named ? { name: named[2], group: false } : null;
};

export const TYPESCRIPT: LanguagePack = {
    id: "ts",
    name: "TypeScript",
    extensions: ["ts", "tsx", "mts", "cts"],
    fences: ["typescript"],
    grammars: [
        { name: "typescript", extensions: ["ts", "mts", "cts"], package: "tree-sitter-typescript", version: "0.23.2", file: "tree-sitter-typescript.wasm", sha256: "778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d" },
        { name: "tsx", extensions: ["tsx"], package: "tree-sitter-typescript", version: "0.23.2", file: "tree-sitter-tsx.wasm", sha256: "79e5da75ea62855a0cd67177685f0164eac87d5f630b3cbe1e0a099751ad30f8" },
    ],
    highlight: { keywords: `${C_LIKE} readonly declare namespace module keyof infer never unknown any satisfies abstract override get set undefined`, comment: "//", blocks: true },
    lines: JS_LINES,
    cases: jsCase,
};

export const JAVASCRIPT: LanguagePack = {
    id: "js",
    name: "JavaScript",
    extensions: ["js", "jsx", "mjs", "cjs", "vue", "svelte"],
    fences: ["javascript"],
    grammars: [{ name: "javascript", extensions: ["js", "jsx", "mjs", "cjs"], package: "tree-sitter-javascript", version: "0.25.0", file: "tree-sitter-javascript.wasm", sha256: "5fb488d0cabb4775a594bab85682de5ad6ce83c0d6ac997a9f82dd084d571240" }],
    highlight: { keywords: `${C_LIKE} undefined get set`, comment: "//", blocks: true },
    lines: JS_LINES,
    cases: jsCase,
};
