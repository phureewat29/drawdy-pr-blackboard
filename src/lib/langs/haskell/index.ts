/**
 * Haskell: a card per declaration from its parser (`linker.ts`), no lines
 * yet. A function's card is named as Haskell writes it, `foldTree`, and holds
 * its type signature and every equation. A file the parser can't read gets a
 * file card, as every Haskell file did before.
 */

import type { CaseRule, LanguagePack } from "../pack.ts";

/** Hspec's `it "does x" $ do` and tasty's `testCase "x" $` (in a list too), with their groups; a string then `do` is RSpec's, not this. */
const haskellCase: CaseRule = (line) => {
    const m = /^\s*(?:[,[]\s*)?(describe|context|it|specify|prop|testCase|testProperty|testGroup)\s+"((?:[^"\\]|\\.)+)"\s*(?:\$|\[|$)/.exec(line);
    return m ? { name: m[2], group: m[1] === "describe" || m[1] === "context" || m[1] === "testGroup" } : undefined;
};

export const HASKELL: LanguagePack = {
    id: "hs",
    name: "Haskell",
    extensions: ["hs"],
    fences: ["haskell"],
    grammars: [{ name: "haskell", extensions: ["hs"], package: "tree-sitter-haskell", version: "0.23.1", file: "tree-sitter-haskell.wasm", sha256: "37a6b07b1a838d02ffb4f4c2a06863637a8efe48432d60a275f50f1d08f1092c" }],
    highlight: { keywords: "module where import qualified as hiding data newtype type family class instance deriving let in case of if then else do forall default infixl infixr infix foreign", comment: "--" },
    lines: { comments: /^\s*--/ },
    tests: [/(Spec|Tests?)\.hs$/],
    cases: haskellCase,
};
