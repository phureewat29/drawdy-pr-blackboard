/** Python: linked by its rule table (`linker.ts`); a method's card is named for its class, `Store.delete()`. */

import type { LanguagePack } from "../pack.ts";

export const PYTHON: LanguagePack = {
    id: "py",
    name: "Python",
    extensions: ["py"],
    fences: ["python"],
    grammars: [{ name: "python", extensions: ["py"], package: "tree-sitter-python", version: "0.25.0", file: "tree-sitter-python.wasm", sha256: "16108b50df4ee9a30168794252ab55e7c93bfc5765d7fa0aa3e335752c515f47", typedMethods: true }],
    highlight: { keywords: "def class return if elif else for while in not and or is None True False import from as with try except finally raise yield lambda pass break continue global nonlocal async await assert del self", comment: "#" },
    lines: {
        patterns: [
            { re: /^\s*class\s+(\w+)/, kind: "class", container: true },
            { re: /^\s*(?:async\s+)?def\s+(\w+)/, kind: "function" },
        ],
        keywordLed: true,
        comments: /^\s*(#(?!\[)|"""|''')/,
    },
    tests: [/_test\.py$/, /(^|\/)test_[^/]+\.py$/],
    cases: (line) => {
        const m = /^\s*(?:async\s+)?def\s+(test)_?(\w+)/.exec(line);
        return m ? { name: `test_${m[2]}`, group: false } : undefined;
    },
    naming: { member: "." },
};
