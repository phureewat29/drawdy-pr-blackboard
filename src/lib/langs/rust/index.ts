/** Rust: linked by its rule table (`linker.ts`); a method's card is named for its type, `Request::new()`, an impl block's `impl Request`. */

import type { LanguagePack } from "../pack.ts";

export const RUST: LanguagePack = {
    id: "rs",
    name: "Rust",
    extensions: ["rs"],
    fences: ["rust"],
    grammars: [{ name: "rust", extensions: ["rs"], package: "tree-sitter-rust", version: "0.24.0", file: "tree-sitter-rust.wasm", sha256: "f65f354215611fd94ad34134b3427eb3d58cbb745df7b6509ba722184db73d57", typedMethods: true }],
    highlight: { keywords: "fn let mut pub crate mod use impl trait struct enum match if else for while loop return break continue self Self super where as in ref move async await dyn const static unsafe true false Some None Ok Err", comment: "//", blocks: true },
    lines: {
        patterns: [
            { re: /^\s*impl(?:<[^>]*>)?\s+(?:[\w:<>, ]+\s+for\s+)?([\w:]+)/, kind: "class", container: true },
            { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|const|unsafe|extern(?:\s+"[^"]*")?)\s+)*fn\s+(\w+)/, kind: "function" },
            { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type|union)\s+(\w+)/, kind: "type" },
        ],
        keywordLed: true,
    },
    naming: { member: "::", container: "impl" },
};
