/**
 * C++: a card per declaration from its parser (`linker.ts`), no lines yet. A
 * member's card is named for its class, `Wallet::Get()`. Headers (`.h`) are
 * read as C++, which reads a C header as well as C's grammar does.
 */

import { C_FAMILY, C_KEYWORDS } from "../c-family.ts";
import type { CaseRule, LanguagePack } from "../pack.ts";

const CASE = /^\s*(TEST|TEST_F|TEST_P|TYPED_TEST|TYPED_TEST_P|TEST_METHOD|BOOST_AUTO_TEST_CASE|BOOST_FIXTURE_TEST_CASE|BOOST_DATA_TEST_CASE|TEST_CASE|TEST_CASE_FIXTURE|SCENARIO|BOOST_AUTO_TEST_SUITE|BOOST_FIXTURE_TEST_SUITE|TEST_SUITE|TEST_CLASS)\s*\((.*)/;
const GROUPS = new Set(["BOOST_AUTO_TEST_SUITE", "BOOST_FIXTURE_TEST_SUITE", "TEST_SUITE", "TEST_CLASS"]);

/** GoogleTest's `TEST(Suite, Name)`, Boost's `BOOST_AUTO_TEST_CASE(name)`, Catch2's and doctest's `TEST_CASE("…")`, and their suites. */
const cppCase: CaseRule = (line) => {
    const m = CASE.exec(line);
    if (!m) return undefined;
    const quoted = /^\s*(?:\w+\s*,\s*)?"((?:[^"\\]|\\.)*)"/.exec(m[2]);
    const args = m[2].split(")")[0].split(",").map((a) => a.trim());
    const name = quoted ? quoted[1] : /^(TEST|TEST_F|TEST_P|TYPED_TEST|TYPED_TEST_P)$/.test(m[1]) ? args.slice(0, 2).join(".") : args[0];
    return name ? { name, group: GROUPS.has(m[1]) } : null;
};

export const CPP: LanguagePack = {
    id: "cpp",
    name: "C++",
    extensions: ["cc", "cpp", "cxx", "h", "hh", "hpp", "hxx"],
    fences: ["c++"],
    grammars: [{ name: "cpp", extensions: ["cc", "cpp", "cxx", "h", "hh", "hpp", "hxx"], package: "tree-sitter-cpp", version: "0.23.4", file: "tree-sitter-cpp.wasm", sha256: "174eb0deb75b2ec7881bcacda9f995648d8e683956e5c2267e69ab6dc503fcbf", typedMethods: true }],
    highlight: { keywords: `${C_KEYWORDS} nullptr constexpr override final noexcept operator friend explicit mutable inline this new delete throw try catch bool`, comment: "//", blocks: true },
    lines: C_FAMILY,
    tests: [/(_tests?|_unittest|Tests?)\.(cc|cpp|cxx)$/],
    cases: cppCase,
    naming: { member: "::" },
};
