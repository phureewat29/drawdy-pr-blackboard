/** Go: linked by its rule table (`linker.ts`); a method's card is named for its receiver's type, `Server.Start()`. */

import type { LanguagePack } from "../pack.ts";

export const GO: LanguagePack = {
    id: "go",
    name: "Go",
    extensions: ["go"],
    fences: ["golang"],
    grammars: [{ name: "go", extensions: ["go"], package: "tree-sitter-go", version: "0.25.0", file: "tree-sitter-go.wasm", sha256: "9504573f352b20be7f2f1911754d710622aedc15afff16d5ed8fb5645681aee7", typedMethods: true }],
    highlight: { keywords: "func package import return if else for range switch case default break continue go defer select chan map struct interface type var const nil true false fallthrough goto", comment: "//", blocks: true },
    lines: {
        patterns: [
            { re: /^func\s+\(\s*(?:\w+\s+)?\*?\s*(\w+)[^)]*\)\s*(\w+)/, kind: "method", group: 2, owner: 1 },
            { re: /^func\s+(\w+)/, kind: "function" },
            { re: /^type\s+(\w+)/, kind: "type" },
        ],
        keywordLed: true,
        inside: /^[A-Za-z_]\w*:\s*$/,
    },
    tests: [/_test\.go$/],
    cases: (line) => {
        const m = /^\s*func\s+(Test)(\w+)\s*\(/.exec(line);
        return m ? { name: `Test${m[2]}`, group: false } : undefined;
    },
    naming: { member: "." },
};
