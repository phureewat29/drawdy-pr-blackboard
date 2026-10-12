/** Clojure, ClojureScript and `.cljc`: linked by its own resolver (`linker.ts`). The highlighter's words have no hyphen, so `if-let` colours as `if` and `let`; only `"` opens a string (`'` quotes a form). */

import type { CaseRule, LanguagePack } from "../pack.ts";

/** A top-level defining form's name: `(defn name`, `(mu/defn ^:private name`. */
const DEF = /^\((?:[^\s()[\]{}"/]+\/)?(defn-?|defmacro|defmulti|defmethod|definline|deftest|def|defonce|defprotocol|defrecord|deftype|definterface)\s+(?:\^(?:\{[^}]*\}|[^\s()[\]{}]+)\s+)*([^\s()[\]{}"^;]+)/;

/** `(deftest name`, and `(testing "…"`, which groups the checks inside it. */
const cljCase: CaseRule = (line) => {
    const test = /^\s*\((?:[^\s()/]+\/)?deftest-?\s+(?:\^[^\s()]+\s+)*([^\s()[\]{}"^;]+)/.exec(line);
    if (test) return { name: test[1], group: false };
    const testing = /^\s*\((?:[^\s()/]+\/)?testing\s+"((?:[^"\\]|\\.)+)"/.exec(line);
    return testing ? { name: testing[1], group: true } : undefined;
};

export const CLOJURE: LanguagePack = {
    id: "clj",
    name: "Clojure",
    extensions: ["clj", "cljs", "cljc"],
    fences: ["clojure", "clojurescript"],
    grammars: [{ name: "clojure", extensions: ["clj", "cljs", "cljc"], package: "tree-sitter-clojure-orchard", version: "0.2.8", file: "tree-sitter-clojure_orchard.wasm", sha256: "8109b2cb1c34f5c2cba5baffe53fbe2f8a823680dcb038dcc146fff800ae145b" }],
    highlight: {
        keywords: "def defn defmacro defmulti defmethod defonce defprotocol defrecord deftype definterface deftest ns fn let letfn loop recur if when cond condp case do doseq dotimes for try catch finally throw quote var new and or not nil true false",
        comment: ";",
        strings: '"',
    },
    lines: {
        patterns: [
            { re: DEF, kind: "function", group: 2, topOnly: true },
        ],
        keywordLed: true,
        comments: /^\s*;/,
    },
    tests: [/_test\.clj[sc]?$/],
    cases: cljCase,
};
