/** Ruby: cards by line patterns, no links yet. */

import type { LanguagePack } from "../pack.ts";

export const RUBY: LanguagePack = {
    id: "rb",
    name: "Ruby",
    extensions: ["rb"],
    fences: ["ruby"],
    highlight: { keywords: "def class module end if elsif else unless while until for in do return yield begin rescue ensure raise nil true false self super require require_relative attr_reader attr_accessor", comment: "#" },
    lines: {
        patterns: [
            { re: /^\s*(?:class|module)\s+([\w:]+)/, kind: "class", container: true },
            { re: /^\s*def\s+(?:self\.)?([\w?!=]+)/, kind: "function" },
        ],
        comments: /^\s*#(?!\[)/,
    },
    tests: [/_test\.rb$/],
};
