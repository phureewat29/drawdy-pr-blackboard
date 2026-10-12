/** Elixir: linked by its rule table and a resolver of its own (`linker.ts`); a function's card is named for its module, `URL.validate()`. */

import type { CaseRule, LanguagePack } from "../pack.ts";

/** ExUnit's `test "…" do` and `describe "…" do`. */
const exUnitCase: CaseRule = (line) => {
    const m = /^\s*(test|describe)\s+"((?:[^"\\]|\\.)+)"/.exec(line);
    return m ? { name: m[2], group: m[1] === "describe" } : undefined;
};

export const ELIXIR: LanguagePack = {
    id: "ex",
    name: "Elixir",
    extensions: ["ex", "exs"],
    fences: ["elixir"],
    grammars: [{ name: "elixir", extensions: ["ex", "exs"], package: "tree-sitter-elixir", version: "0.3.5", file: "tree-sitter-elixir.wasm", sha256: "ed99093c548c12d43f7e337fd3440e9e2daa2ec671a5e29aadb6c6dcb2232a62", typedMethods: true }],
    highlight: {
        keywords: "def defp defmacro defguard defdelegate defmodule defprotocol defimpl defstruct do end fn case cond with for if unless else try rescue catch after receive raise quote unquote alias import require use when and or not in true false nil",
        comment: "#",
    },
    lines: {
        patterns: [
            { re: /^\s*(?:defmodule|defprotocol|defimpl)\s+([\w.]+)/, kind: "class", container: true },
            { re: /^\s*(?:def|defp|defmacro|defmacrop|defguard|defguardp|defdelegate)\s+([a-z_][\w]*[?!]?)/, kind: "function" },
        ],
        keywordLed: true,
        comments: /^\s*#/,
    },
    tests: [/_test\.exs?$/],
    cases: exUnitCase,
    naming: { member: ".", container: "defmodule" },
};
