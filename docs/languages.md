# Languages

PR Blackboard reads every language through a language pack: a folder in
`src/lib/langs/`. The core (reading, the review, layout, cards, the driver)
knows no language. It reads them through two lists and one contract,
`src/lib/langs/pack.ts`.

| Language | Pack | Cards | Lines |
|---|---|---|---|
| TypeScript, JavaScript | `javascript/` | parsed | own linker |
| Vue, Svelte components | `javascript/` | script blocks parsed | own linker |
| Python | `python/` | parsed | rule table |
| Go | `go/` | parsed | rule table |
| Rust | `rust/` | parsed | rule table |
| Java | `java/` | parsed | rule table, own resolver |
| C# | `csharp/` | parsed | rule table, own resolver |
| PHP | `php/` | parsed | rule table, own resolver |
| Elixir | `elixir/` | parsed | rule table, own resolver |
| Clojure, ClojureScript | `clojure/` | parsed | rule table, own resolver |
| C | `c/` | parsed | rule table, own resolver; headers are C++'s files |
| Kotlin, C++, Scala, Haskell | `kotlin/`, `cpp/`, `scala/`, `haskell/` | parsed | none: units only |
| Swift, Ruby | `swift/`, `ruby/` | line patterns | none |
| CSS, HTML, JSON, YAML, TOML, Markdown, shell, SQL | `formats.ts` | whole files | none |

## The contract

A pack has two parts.

**The pack**, `index.ts`, exports a `LanguagePack`: plain data that both the
driver and the parser worker read.

| Field | What it says | Read by |
|---|---|---|
| `id` | A short, stable code that reviews store: `py`, `rs` | everything |
| `name` | What the reader is told: "Downloading the Python parser" | `driver/grammars.ts` |
| `extensions`, `names`, `fences` | Which files are this language, and which Markdown fences | `language.ts` |
| `grammars` | Each tree-sitter grammar: its name, the extensions it parses, its pin (npm package, version, file, SHA-256), and whether its cards name methods with their type | `language.ts`, `driver/grammars.ts`, `card/` |
| `highlight` | Keywords, the line comment, block comments, the characters that open a string; `false` for plain text | `highlight.ts` |
| `lines` | Line patterns that find declarations where no parser reads the file, and comment lines | `symbols.ts` |
| `tests`, `cases` | Test file names (`_test.go`), and test case names (`describe("…")`) | `language.ts`, `symbols.ts` |
| `naming` | How a card joins a member's type to its name: `Store.delete()`, `Request::new()` | `symbols.ts` |

**The linker**, `linker.ts`, exports a `Linker`: how the parser worker turns
the files into units and references. It comes in two kinds.

- A `RulesLinker` plugs a rule table into the shared linker
  (`anyfacts.ts`, `anylink.ts`): `units`, the grammar's `tags.scm`, whose
  `definition.*` captures are the declarations; `rules`, how the syntax
  reads; `resolver`, how names resolve; and the read hints, the files the
  read tier fetches beside a changed file (`configFiles`, `packageMarkers`,
  `isPackage`, `wants`). Every rule table is linked in one pass.
- An `OwnLinker` indexes and links its files itself, as JavaScript and
  TypeScript do. Its `session` hooks into set points of the read tier
  (`sources.ts`): before the changed files, after them, before imports,
  each import, then the link step.

Both kinds may give `prepare` (a text repair for a grammar's gap),
`isImport` (which top-level statements import), `local` (names never
leave their file) and `blocks`: files of another format whose code sits in
blocks, read by the linker's grammars. For each such file, by extension,
`blocks.read` gives the grammar its blocks are written in and the text to
parse: the file's own length, everything outside the blocks blank, so
cards and lines keep the file's own lines. A file whose blocks it can't
read cleanly gets line-pattern cards. An own linker's `index` may still
refuse a tree it can't trust.

**Vue and Svelte components** (`javascript/components.ts`). A `.vue` file's
top-level `<script>` and `<script setup>`, and a `.svelte` file's instance
and module scripts, are found the way Vue's and Svelte's own parsers find
them, and parsed with the TypeScript, TSX or JavaScript grammar their tag
names; a syntax error in them leaves the file to line-pattern cards. The
component is a card of its own, its file whole: what its default
export names, and where changes outside its functions go, its template's
among them. `<script setup>` and the instance script see the other block's
names and every import; the other block sees neither their declarations
nor a name both declare (the file then gets line-pattern cards). Templates
and markup draw nothing. Nor do Vue's compiler macros (`defineProps`,
`withDefaults` and the rest), Svelte's runes, or `this` in a Vue
component's options. Svelte's `$store` reads the store its instance script
names at the top level, unless a nearer name hides it. An import of
`X.vue` or `X.svelte` names the component for its default export, and its
outer block's exports by name. Lines go to the code that runs: a
declaration file beside the code it describes (`x.d.ts` beside `x.js`,
`X.vue.d.ts` beside a component, an ambient `declare module` that tsconfig
`paths` also maps) never takes a line from it.

A language whose calls can't be proven yet gets a linker of units alone,
`unitsOnly` (`units-only.ts`): a rule table with units and nothing else,
and a resolver that names nothing, apart from every other language's. Its
files get a card per changed declaration, and draw no line. A declaration
whose range the parser can't vouch for is no unit (in or right before an
ERROR node, or a check of the pack's own), so its lines go to its file's
card. `UnitRule` may give a unit's `end`, where its node runs on over blank
lines and comments (Scala's indented blocks), and its `doc`, where its doc
comments aren't its siblings in the tree (Haskell's `-- |`).

**The two lists.** `langs/index.ts` lists every pack (`PACKS`);
`langs/linkers.ts` lists every linker (`LINKERS`). A pack with no linker
gets cards from its line patterns and draws no lines; so does a file the
parser can't trust, whatever its pack. The lists are
apart because the driver bundles `PACKS`, and a linker would bring the
parser into it: `npm run check` fails when any file of a pack's folder
but its `index.ts` reaches the driver. So `index.ts` imports no parser
code, and everything else in the folder belongs to the parser worker.
`langs/packs.test.ts` fails when a pack with a grammar has no linker.

C and C++ share one resolver (`c/resolver.ts`): a header (`.h`) is read
by C++'s grammar, which reads C headers better than C's does, so C's lines
need C++'s files. C++'s own files draw no line: its calls turn on
overloads, argument-dependent lookup and templates, and the subset a
board can prove came to about 10 % of bitcoin's calls before its
blockers.

C's lines are as sure as the files a board reads: the build files above a
changed file, what they include, and the folders their links lead to. Out
of reach:

- flags and source lists from the command line, the environment or
  configure, and packages the build imports (`find_package`, pkg-config,
  Meson's `dependency()`, FetchContent even from the repository's own
  folders); a link variable no file read sets, named as a library list
  (`${FOO_LIBRARIES}`), counts as a package's;
- a variant only a build file nothing read names, a source list a
  subfolder hands up with `PARENT_SCOPE`, a chosen source the build copies
  into its build folder under the same name, or a variant no build file
  names (`io_w32.c` beside `io.c`);
- a macro an unlisted library's header makes of a name unlike the header's
  (`<foo/bar.h>` making `baz_open` a macro).

Packs share what is common through plain modules beside them:
`c-family.ts` (the C family's keywords and line patterns) and
`formats.ts` (the file kinds with no declarations). What applies to every
file whatever its language stays in the core: test folders and suffixes,
`//` and `/*` comment lines, lines that look like imports, the lockfiles
and generated folders, and when the parser's tree isn't trusted (a leading
`@flow`, or more than 2 % of the file in syntax errors).

## Size

A pack's `index.ts` ships twice in the marketplace bundle, in the driver
and in the parser worker's script, so keep it to data; a linker ships once,
minified, in the worker's script. Measured in the bundle, a pattern-only
pack costs about 1 KB; a units-only pack 3 to 6 KB, and `units-only.ts`
3 KB; a pack with a rule table 15 to 40 KB (Go 15 KB, Rust 21 KB, Python
22 KB, PHP 28 KB, Elixir 30 KB, Clojure 39 KB); JavaScript and TypeScript,
68 KB with Vue and Svelte components; C#, 55 KB; C, with its build-file
reader and libraries' macros, 97 KB; Java, with the JDK's types, 98 KB. A
grammar's wasm file is downloaded apart, once. The bundle's check is 1 MB.

## Add a language

A language ships in two steps: cards first, lines once they are proven.

1. **Pack.** Add `src/lib/langs/<name>/index.ts` with its `id` (the usual
   extension), `name`, `extensions`, `fences`, `highlight`, `lines` and
   `tests` (model: `ruby/`), and its line in `PACKS`. Run `npm run worker` and
   `npm test`. This ships alone: the language's files get cards and
   colours, and no lines.

On a branch, until the last step:

2. **Grammar.** Find an npm package that ships a prebuilt wasm file for
   web-tree-sitter 0.27, often `tree-sitter-<name>`. Add it as an
   exact-version devDependency, and the grammar to the pack: `name`,
   `extensions`, `package`, `version`, `file`, and `sha256` from
   `shasum -a 256 node_modules/<package>/<file>`, and `typedMethods` when
   its cards will name methods with their type. The driver downloads it
   from jsDelivr at that version and refuses any other hash.
3. **Units.** Copy the package's `queries/tags.scm` unchanged into
   `linker.ts` as `units`. Where it has none, write a query whose
   `definition.<kind>` captures sit on the declarations, with a `@name`.
   With `unitsOnly` (`units-only.ts`) the language can ship here: a card
   per declaration, no lines. Check the units' ranges against a compiler
   or the code's layout on real files first.
4. **Rules and read hints.** Write the rule table (`rules.ts`): scopes,
   bindings, identifiers, imports and card names. Then the resolver
   (`typing.ts`), how a module names files (`modules.ts`), what the read
   tier fetches beside a file, and which statements import (`isImport`). Start from the closest pack: `python/`
   (modules by path), `go/` (packages, `go.mod`), `rust/` (one file),
   `java/` (a resolver of its own). A name links only when exactly one
   declaration is proven. Add the linker's line to `LINKERS`: the tests and
   the gate need it.
5. **Unit tests.** Test each rule with a case that links and a case that
   must make no link: a local, an unknown receiver, an import not read, two
   declarations of one name, shadowing. Follow `anyfacts.test.ts` and
   `anylink.test.ts`.
6. **Truth gate.** In the score gate (`research/gate/`, beside this
   repository), add a group to `groups.ts` with its PRs
   (`truth/<group>/prs.json`, each with GitHub's saved answers), a frozen
   truth and a scorer in `scorers.ts`. Take truth from the language's own
   compiler or type checker where one runs (`java40`: javac's references,
   `scoreJava`), else check every link by hand (`typst`: a fixture,
   `scoreRust`; `elixir`: every call on its boards' cards, `scoreJava`).
   The group must show 0 wrong lines, and its recall bar must hold.
7. **Review.** Have someone who didn't write the linker hunt for wrong
   lines: synthetic cases for every rule, and a whole-repository comparison
   with the compiler where one exists, as Java's review did. Fix every
   wrong line, then gate again.
8. **Docs and ship.** Update the table above, the README's language list
   and the CHANGELOG. Run `npm run worker`, `npm test`,
   `npm run typecheck`, `npm run check` and the whole gate, then merge:
   lines are drawn from here on.
