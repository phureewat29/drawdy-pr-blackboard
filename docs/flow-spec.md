# PR Blackboard: the investigation board

The spec for the board, the reading flow with and without the panel, and
the panel itself: what a reviewer needs to understand a pull request and
move through it, and nothing else (section 10 lists what was cut). Worked
examples: honojs/hono#5513 (`src/lib/fixtures/hono-5513.json`) and the
stress case excalidraw/excalidraw#12237
(`src/lib/fixtures/excalidraw-12237.json`, 9.4).

## 0. The product

1. The reader pastes a link to a public GitHub pull request into the
   panel. Only GitHub works, and the panel says so.
2. PR Blackboard pins it to the board: a PR card with the description as
   GitHub shows it, one card per changed function, test file or loose
   file, joined by labelled strings that hang in a curve, like string
   pinned across a real board, and bend round the cards in their way.
3. The board reads left to right (callers first) and top to bottom (the
   change, the row under it, the rest).
4. The board works on its own. With the panel closed, after a reload, or
   on a teammate's screen, a reader can follow any string and open Read
   all from a card's last row, which says `Read all` whenever the card
   hides code. The panel adds what only it can do: open a pull
   request, walk the cards in order, list every link of a card, drawn or
   not.
5. Read all, the one popover, shows a whole function, file or description
   right of its card. Nothing opens on a plain click. PR Blackboard explains;
   it never judges.

## 1. One meaning per mark

| Mark | Means |
|---|---|
| A string's colour | Which string it is, so crossing strings can be told apart. Strings that leave one card share its colour; cards whose strings cross, run close or meet at one end get different ones (3.4.4) |
| A string's label, in the string's colour | What the string means, in one word: `calls`, `uses`, `tests`, `imports` (2.2.6) |
| Dashed (string or card border) | Unchanged code |
| Green row, green `NEW` chip | Added lines; a function that is all new |
| Red row | Deleted lines |
| `→` in a card's gutter, and in Read all's | This line calls another card on the board |
| Outline tag in monospace, `honojs/hono#5513` | A pull request: on the PR card, in the panel's header, on the example rows |

Colour no longer says a string's kind; its label does. A string keeps its
colour and width as the reader moves. Lime appears nowhere on the board;
the panel's lime is Drawdy's primary colour, on Next alone. `+202 −11` uses the cards' green and red. The strings carry their
own words, so the board needs no legend and no instructions line.

## 2. What is pinned

| Element | Made of | Holds |
|---|---|---|
| PR card | component, 640 wide | Header (`[honojs/hono#5513]`, state chip), title, author and `4 files · +202 −11`, the not-pinned line when needed, then the description as GitHub-flavoured Markdown (5.5) |
| Change card | component | One changed declaration (5.1) |
| Context card | component, dashed border in its HTML | Unchanged code that calls or uses a thread's entry, chip `UNCHANGED` |
| Test card | component, chip `TESTS` | One test file, folded to its case names |
| File card | component | A file with no readable declarations: imports, config, docs |
| String | native arrow, bound to both cards, 3 bend points (more through columns, 3.4.3) | One link between two cards (3.4) |
| Label | native text, 16, its string's colour | `calls`, `uses`, `tests` or `imports` |

That is all. No board title, sticky notes, rings, lane labels or note lane.
Readers make their own notes with Drawdy's tools.

### 2.1 Which cards

2.1.1 A **thread** is a set of changed declarations joined by links
(2.2); each thread is a band. At most one **context card** per thread: the
first unchanged, non-`@deprecated` caller of its entry in the files already
read (hono: `fetch()`). A **test file** covers the changed declarations it
has a `tests` link to (2.2.6); a file name alone is no evidence, so
`hono.test.ts` does not cover the private `#dispatch()` in `hono-base.ts`.
A test file hangs under the first thread whose change cards it covers; a
link into a context card places nothing. A file card whose links all go
into one thread hangs under it too (hono: the imports card, which imports
`toError()`).
Together they make the **row under** the band. Everything else (lone
functions, doc comments, config, docs that name no card or cards in two
threads, tests of those) goes in the **bottom row**.

2.1.2 **Limit: 32 cards,** the PR card and context cards included. The
model fills in this order until 32: whole threads, largest first, each
with its context card and tests; then the bottom row's code, then its docs
and config, then generated files. A thread that does not fit whole keeps
the cards nearest its entry. `Review.unpinned = { functions, files }`
counts what has no card; the PR card reads `28 functions and 2 files not
pinned`, leaving out a zero part and using `1 function`, `1 file`.

### 2.2 Link finding

A string must be a fact. For TypeScript and JavaScript (`.ts .tsx .mts
.cts .js .jsx .mjs .cjs`) PR Blackboard parses every file it reads with
tree-sitter and follows each name to the declaration it means: through
scopes, imports and re-exports, and members whose receiver it can name.
Only a reference that resolves makes a link. Other languages keep the line
patterns and draw only `calls` and `imports` (2.2.7).

Measured on the 15 scored pull requests (the operator's research,
`SCRATCH/research/truth`, `exp-parser` and `holdout`), against
TypeScript's `findReferences` plus hand judgments: the regex finder drew
51 wrong links of 162; this design (approach A with the builtin rule)
drew none wrong of 169 and found every link TypeScript finds on the ten
held-out pull requests. It misses calls through untyped parameters,
dispatch chosen at run time, and handler arguments typed only through a
library's generics; those stay off the board.

**Fewer strings, every one right.** Boards lose the strings the old finder
guessed: elysia#1734 goes from 27 links, 19 of them wrong, to 16;
Python, Go and Rust boards lose `uses` and `tests`; docs and config cards
lose `mentions`; some test cards sit in the bottom row with no string.
Neither the board nor the panel says that links were left out: no count,
no note, no legend, no "unresolved" row. A string is a fact, and the
panel lists every resolved link, drawn or not (3.4.1), and nothing else.
An uncertain link is neither drawn nor listed.

2.2.1 **Modules.**

| Module | What it does | Replaces |
|---|---|---|
| `vendor/web-tree-sitter.ts` | web-tree-sitter 0.27.1's `web-tree-sitter.js` (MIT), vendored as `marked` is, with three patches: its Node-only branches go (`import("module")`, `import("fs/promises")`, the `fs` loader) and `import.meta.url` reads `undefined`. Unpatched, the marketplace build refuses the bare imports `module` and `fs/promises`. Header: version, the npm file's SHA-256 (`7c49e3c1…4b8110`), the patches, `// @ts-nocheck` | |
| `lib/sha256.ts` | SHA-256 in plain TypeScript; the driver's worker has no `crypto.subtle` | |
| `lib/syntax.ts` | A's: grammar by extension, `loadSyntax(bytes)` (`Parser.init` with `wasmBinary` and a `locateFile`, which the bundle needs since it has no module URL), the tree flattened into typed arrays, the call-signature repair for tree-sitter-typescript 0.23.2 | the JS patterns in `findDecls` for parsed files |
| `lib/facts.ts` | A's: per file, the declarations a card can stand for (units), scopes and bindings, every identifier that refers to something (sites), imports, exports, class and object shapes | |
| `lib/linker.ts` | A's resolver, less its uncertain results (2.2.5) | `useEdges`, `referenceRows`, `importEdges` and `mentions` for parsed files |
| `lib/sources.ts` | The read tier (2.2.3): tsconfig paths, import candidates, reading through an injected `read(path)` | the source list in `open.ts` |
| `lib/model.ts` | Cards and links from A's `board.ts`: line ownership, thread edges, the context caller, file cards, links by region. `Review`, `Pin` and `Link` keep their shape; a parsed unit becomes a `ChangedSymbol`, id `path:nameLine` | `symbolBoard`, `fileBoard`, `addTests` and the mention block |
| `lib/symbols.ts` | Today's finder, now only for files the parser doesn't read (2.2.7), and `testCases` | |
| `driver/grammars.ts` | The pins, the download, kv-storage, the parse that loads a grammar an import needs (2.2.2) | |
| `driver/words.ts` | `inWords`: an error whose message the panel shows as it is | the runtime's `IN_WORDS` |
| `driver/open.ts` | `loadReview`: the pull request, its files, the grammars, the read tier, `buildReview` | |

`buildReview` stays pure: it takes the pull request, its files, the texts
read, and the facts and resolved sites. The facts are not stored; the
stored review holds what it holds today, and `REVIEW_VERSION` becomes 7.

2.2.2 **Loading tree-sitter.** The driver runs the parser, so the board
works with the panel closed (Read all on a teammate's screen rebuilds the
review). Proved in Drawdy's own sandbox (`drawdy.io/sandbox/bootstrap.html`
in an `allow-scripts` iframe, its `host-worker.js`, the driver evaluated by
`new Function`): a blob worker of origin `null`, no `document`, no
`crypto.subtle`, fetches the files below from jsDelivr (CORS `*`, no CSP on
drawdy.io or the bootstrap), checks them with `sha256.ts` (8 ms for the
runtime, 30 ms for TypeScript), parses and resolves.

| Key | URL on `https://cdn.jsdelivr.net/npm/` | Bytes | gzip | SHA-256 |
|---|---|---|---|---|
| `wasm:runtime` | `web-tree-sitter@0.27.1/web-tree-sitter.wasm` | 210 415 | 83 KB | `beca80e44cccbf2299ed4d1e3fa6462a9a6fe818aeebf847547a392227ce4acc` |
| `wasm:typescript` | `tree-sitter-typescript@0.23.2/tree-sitter-typescript.wasm` | 1 413 849 | 133 KB | `778025db5a8be0e70f8ccc3671e486dfeddd048c25d9e8a70c26de2e1bf6f97d` |
| `wasm:tsx` | `tree-sitter-typescript@0.23.2/tree-sitter-tsx.wasm` | 1 445 638 | 136 KB | `79e5da75ea62855a0cd67177685f0164eac87d5f630b3cbe1e0a099751ad30f8` |
| `wasm:javascript` | `tree-sitter-javascript@0.25.0/tree-sitter-javascript.wasm` | 411 770 | 49 KB | `5fb488d0cabb4775a594bab85682de5ad6ce83c0d6ac997a9f82dd084d571240` |

- `.ts .mts .cts` (and `.d.ts`) take `typescript`, `.tsx` takes `tsx`,
  `.js .jsx .mjs .cjs` take `javascript`. A pull request loads the
  runtime and only the grammars its files need, started as soon as the
  file list is known, beside the raw reads; a grammar an import needs
  loads when that import is read.
- **Storage.** Each file is one kv-storage key, payload `{ sha256, blob }`,
  a `Blob` as Janitor keeps its model files (`model-store.ts`): kv-storage
  is IndexedDB on drawdy.io's origin and keeps a `Blob` by structured clone.
  A stored `sha256` other than the pin is a miss and the download
  overwrites it, so a new pin leaves no stale key.
- **Every byte is checked.** Bytes from jsDelivr or from storage reach
  WebAssembly only after `sha256.ts` matches the pin. A mismatch or a
  failed download fails the open in words (7.2.2); nothing is half
  loaded and nothing is pinned. Without the storage permission the files
  download once per session.
- **A parser that won't run fails the open too.** When the runtime or a
  grammar won't load, or parsing throws for a reason other than one
  file's text, the open fails in words (7.2.2) and pins nothing: a board
  whose TypeScript strings quietly came from the line patterns would look
  as sure as one that didn't. One file the parser can't read is not a
  failure; it falls back as 2.2.7 says.
- **What the reader sees:** a download is its own loading step, shown
  only when bytes come over the network (7.2.6); the stored copy's check
  shows nothing.
- **First run:** 1.62 MB stored for a TypeScript pull request (216 KB
  over the wire), 3.07 MB with TSX (352 KB), 0.62 MB for JavaScript alone
  (132 KB). Later opens read storage, and later pull requests in the
  session reuse the loaded parser.
- The loaded languages live for the session. Parsing yields to the event
  loop between files, so the shared worker keeps answering other
  extensions; the facts are dropped once the review is built.

2.2.3 **The read tier.** All from `raw.githubusercontent.com` at the head
commit, which costs no API quota; the GitHub API costs what it costs today,
1 request plus 1 per 100 changed files. Each path is fetched at most once.

1. The changed code and test files (up to 40 code files and 40 test
   files, each under 400 000 characters). Past 40, the files with the most
   changed lines, as request 40 sets out for big pull requests; none of the
   scored pull requests reaches 40.
2. The `tsconfig.json` or `jsconfig.json` nearest each changed file,
   trying each directory up to the root, then its relative `extends` (4
   deep at most), for `baseUrl` and `paths`; `.d.ts` files a config names
   in `files` or a wildcard-free `include`.
3. Each changed file's direct imports (`import`, `export … from`,
   `require()`, `import()`): A's candidates in TypeScript's order
   (`x.ts`, `x.tsx`, `x.d.ts`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`,
   `.cjs`, then `x/index.*`; `x.js` tries `x.ts` first; `paths` for bare
   names), one at a time until one answers; a 404 is a miss. Up to 300
   imported files. Nothing past the direct imports, and no scan for
   importers: neither changed a link on the scored pull requests.
4. The builtin files of 2.2.5, which are changed files and so already read.

Up to 8 requests in flight. Measured with git at each head (`SCRATCH/
links-plan/sim/requests.ts`):

| Pull request | Files read | Raw requests (404s) | Text |
|---|---|---|---|
| hono#5513 | 4 changed, 14 imported | 75 (56) | 0.29 MB |
| elysia#1734 | 6, 14 | 38 (17) | 0.52 MB |
| bun#34519 | 7, 8 | 51 (30) | 0.31 MB |
| node#63047 | 4, 15 | 96 (74) | 0.41 MB |
| excalidraw#12237 | 10, 91 | 231 (126) | 1.53 MB |
| vite#23586 | 4, 26 | 54 (22) | 0.68 MB |
| the other nine held out | 2 to 5, 7 to 90 | 19 to 189 | 0.08 to 1.32 MB |

Most 404s are directory imports (`./client` is `client/index.ts` after
nine misses) and the config search. Linking itself makes no request: a
module not read is unknown, which makes no link.

2.2.4 **Cards from units.** For parsed files the units of `facts.ts` are
the declarations: module-level functions, classes, types, values and
namespaces; class methods, accessors and function-valued fields; methods
of module-level object literals; `X.prototype.y = function`, `P.y =
function` with `P = X.prototype`, and `module.exports.y = …`. A function
nested in a function belongs to the outer one. Overloads are one unit.

- A changed line belongs to the innermost unit whose range, from its
  first attached comment to its last line, holds the line's head position
  (a deletion sits at the head line after it). Added blank lines belong
  to nothing.
- **First Vite case** (vitejs/vite#23586, `asset.ts`): a line deleted
  right before a declaration, or before the comment above it, belongs to
  that declaration, so its card shows it and no `asset.ts, other lines`
  card repeats it. And any loose run whose every line falls inside a change
  card's shown lines joins that card instead of making a file card.
- A change card spans its unit's lines, from the first changed line when
  that comes earlier. Its name is `name()` for functions and methods,
  `class X`, `type X`, `namespace X`, or the bare name of a value.
- Changed lines outside every unit make file cards, in runs as today.
  **Second Vite case** (`css.ts` and `html.ts` in vitejs/vite#23586): a
  run whose every changed line sits inside an import statement (`import`,
  `export … from`, or a module-level `const … = require(…)`) by the syntax
  tree, blank lines aside, is named `css.ts imports`, and its string is
  `imports`. The line patterns decide this only for unparsed files.
- The context card: the first unchanged, non-`@deprecated` function or
  method in the files read, its own file first, then changed files, whose
  own code holds a resolved reference to the thread's entry.

2.2.5 **Resolving a name.**

- A bare name resolves through block, function, class and module scopes,
  with `var` hoisted. A name declared nearer wins, so a test's own `app`
  is never the example file's `app`.
- Another file's declaration is reachable only through an import:
  named, default, namespace (`ns.x`), `require()` with destructuring
  (`const { a: x } = require('m')`), `import x = require()`, re-exports and
  `export *`. CommonJS `module.exports` and `exports.x` count as exports.
- Members resolve when the receiver's shape is known: `this` and `super`,
  a class or namespace, a module namespace, an object literal, a local
  built with `new C()` or typed `C` (also `Partial<C>`, unions, `T["k"]`),
  a constructor function's prototype, and `Object.assign(X, {…})`.
- A member set only on some paths (`if (x) this.emit = f`) names only the
  members always set. Object keys, strings, template strings and comments
  are never references.
- **Unresolved means no link.** An untyped parameter, a call's result, a
  global, a package, or a member of anything unknown resolves to nothing.
  A's uncertain results (candidates by member name) go, with their code.
- **The builtin rule**, the only guess, for two layouts where it holds: in
  `nodejs/node`, a bare `x` or `node:x` naming a Node built-in means
  `lib/x.js`; in `oven-sh/bun`, `src/js/node/x.ts` with `/` read as `.`
  (`fs/promises` is `fs.promises.ts`). Only when the pull request changes
  that file. The built-ins are Node 24's `builtinModules`, as a constant;
  names Node lists only with `node:` match only with it. The repository is
  the pull request's base, `pr.ref`.

2.2.6 **Links and kinds.** Each resolved reference goes from the innermost
card holding it to the card standing for its target: the target's own
card, a card it is nested in when it has none, or the file card showing its
changed lines. Two declaration cards that nest make no link. A pair gets
one link:

| Kind | When |
|---|---|
| `tests` | From a test card: any resolved reference to the card's declaration. Another file names it only through an import, so the test imports it |
| `context` | From the context card. It reads `calls` when one of its references is a call, else `uses`, on the string's label and in the panel: the context card is chosen by any resolved reference, so it may only use the entry |
| `calls` | Some reference is the callee of a call, `new` or a decorator |
| `uses` | Any other reference but an import or export |
| `imports` | Only imports and exports |

`rows` are the lines of the call references for `calls` (else of every
reference), which get `→`; the string starts at the first changed call row,
else the first call row, else the first changed row, else the first. No
`mentions`: docs and config files link to nothing. Threads join change
cards by links between them; a class never starts one, since its range
holds every unchanged method.

2.2.7 **Other languages.** Python, Go, Rust, Ruby, Java, Kotlin, Swift,
C#, PHP, C, `.vue` and `.svelte` (highlighted as JavaScript, not parsed),
and a JavaScript or TypeScript file the parser can't read keep
`symbols.ts`. A file can't be read when its leading comments carry
`@flow`, or when ERROR and MISSING nodes cover more than 2 % of its bytes
(request 40: React's Flow files broke A, 56 of 57 with errors, and A
pinned a card 1 300 lines long). The scored pull requests and the 13
examples peak at 0.6 % (elysia's `src/types.ts`, TypeScript's `in out`
variance); React#37113's two changed source files, both `@flow`, measure
3.2 % and 100 %, so the line sits at 2 % (`MAX_ERROR_SHARE` in
`syntax.ts`). A file the parser doesn't read is not followed for imports. `symbols.ts` finds
declarations by shape and indentation, and draws only two kinds. `calls`: a changed declaration whose body calls another
by name (the name followed by `(`); the context card only when it calls
the entry. `imports`: a run of import lines that adds a name another
card declares, and in files mode Python's relative imports. No `uses` and
no `tests`: measured at 52 % and 36 % right, and the errors are not a
language's. Test cards of these languages sit in the bottom row.

2.2.8 **Tests** (Jest; the grammars come from exact-version
devDependencies `web-tree-sitter@0.27.1`, `tree-sitter-typescript@0.23.2`
and `tree-sitter-javascript@0.25.0`, never at run time):

- `sha256.test.ts`: the standard vectors, Node's own hash at every length
  around a block's padding, and each devDependency `.wasm` hashes to its
  pin, so the bytes tested are the bytes shipped.
- `grammars.test.ts`: the pins; a first load downloads once, says so once
  and stores `{ sha256, blob }`; a later session reads storage with no
  network; a failed download and a wrong hash each fail in words and store
  nothing; a stored copy that isn't the pin downloads again; a runtime that
  won't start fails with `Couldn't parse this pull request's TypeScript.`
- `syntax.test.ts`: TypeScript, TSX and JavaScript parse; hono's generic
  call signature parses without an error after the repair; a `@flow` file
  and one over the error line go to the line patterns.
- `facts.test.ts`: the unit kinds of 2.2.4 with their lines and ids, and
  that names in strings, templates, comments and object keys are not
  sites.
- `linker.test.ts`: shadowing; named, default, namespace, re-export and
  `require` imports; `this`, `super`, `new C()`, typed locals and
  prototype assignments; an untyped parameter and a conditional
  `this.emit` make no link; the builtin rule in `nodejs/node` and
  `oven-sh/bun`, not in `honojs/hono`, and not for a file the pull request
  leaves alone.
- `sources.test.ts`: a fake `read` gets changed files, configs and direct
  imports only, each path once, candidates in order.
- `model.test.ts`: hono's ten links, the two Vite cases on their own small
  diffs, no `mentions`, calls and imports only for a Python pull request.
- `open.test.ts`: `loadReview` through a fake fetch, cold (one jsDelivr
  request per file needed) and warm (none); a wrong hash fails in words
  and stores nothing.
- Fixtures gain `raw`: every path the read tier fetched with its text, and
  `null` for each 404, saved from git at the head (no GitHub request).
  `check.ts`, the previews and the gate serve a saved pull request through
  one fake fetch. `check.ts` also serves the pinned files from
  `node_modules`, and on the reload boot expects no jsDelivr request.

2.2.9 **The score gate.** Before the build stage ends, the gate runs
PR Blackboard's own `loadReview` on the 15 scored pull requests through a fake
fetch and scores `review.links`, all of them, drawn or listed, with the
research's rules (`exp-parser/scripts/score.ts`, `truth-ext.ts`). It
passes when no link is wrong, in pair or kind (`context` counts as
`calls` or `uses`), and on every pull request recall is at least A's on
its own cards with hand judgments: elysia#1734 80 %, bun#34519 86 % (with
the builtin rule), elysia#1802 77 %, the others 100 %; three have no
truth link and must draw none. It lives outside the repository, in
`SCRATCH/research/gate/`; section 11 lists what it prints.

## 3. Layout

Canvas units, from the board's top-left corner. `space.ts` still places the
board in free space near the camera.

### 3.1 The hono#5513 board

A sketch: the host draws each string as a smooth curve through its bend
points (3.4.3), not the corners shown here. Arrowheads point at the
callee, the code under test, or the imported card. Strings into one edge
of a card meet at one point.

```
x:0                 640  673  833                       1643    1803                    2529    2689
y:0 ┌[honojs/hono#5513] Merged  ┐  ┌ #dispatch()          … ┐
    │fix(hono): handle non-Error │ ╭▶                         │
    │throws with onError         │ ││ │ → return this.#handle… ├─•──╮ calls  ┌ #handleError()   … ┐
    │usualoma · 4 files +202 −11 │ ││ │                         │    ╰─•────▶│                    │  calls  ┌ toError() NEW    ┐
    │────────────────────────────│ ││ │ → const composed = com… ├──╮        │ → const error = t… ├────────▶●                  │
    │A value thrown from a       │ ││ │                         │  │ calls  └────────────────────┘     ╭──▶│                  │
    │handler … `Error` instance  │ ││ └─────────────────────────┘  ╰────╮                             │   └────────▲─────────┘
    │• `compose` and `Hono#han…  │ ││                                    ╰──▶┌ compose()       … ┐   │calls        │
    │Behavior change (h3)        │ ││                                        │ → const error = t… ├───╯             │ imports
    │A non-Error thrown from a … │ ││ calls                                  └─────────▲──────────┘                 │
    │⋯ Read all                  │ ││                                                  │ tests                      │
    └────────────────────────────┘ ││                                  ┌ compose.test.ts TESTS   ┐   ┌ hono-base.ts imports   ┐
    ┌╌ fetch() UNCHANGED ╌╌╌╌╌╌╌╌╌╌╌┐│                                  └─────────────────────────┘   └────────────────────────┘
    ╎ → return this.#dispatch(…)    ├╯
    └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
    ┌ onError()                      … ┐ tests ┌ hono.test.ts TESTS       ┐
    │                                  │◀──────┤                          │
    └──────────────────────────────────┘       └──────────────────────────┘
```

Built rects (x, y, width; heights from 5.1 and 5.5), pinned in
`layout.test.ts`: PR card (0, 0, 640; 675 tall, its description cut after
"Behavior change" and its paragraph), `fetch()` (0, 723, 673),
`#dispatch()` (833, 0, 810), `#handleError()` (1803, 218, 726),
`compose()` (1803, 514, 726: its column's width, 3.3.1), `toError()`
(2689, 356, 880). The board's left edge is straight: the PR card,
`fetch()` and `onError()` all start at x 0. The row under starts 72 below
the band's lowest card, `fetch()`: y 983 for `compose.test.ts` (x 1822)
and the imports card (x 2842). The bottom row starts 96 below that: y 1307
for `onError()` (x 0) and `hono.test.ts` (x 1040). The board is 3569 ×
1535. Eight strings, one for every link: four `calls`, one dashed `calls`
from `fetch()`, two `tests`, one `imports`. Seven are violet; `compose()`'s
string to `toError()` is orange, since it meets `#handleError()`'s at
`toError()`'s header.

These figures predate the link rebuild (2.2), which gives hono ten links:
two more, `imports` from the imports card to `compose()` (line 7 imports
both) and `tests` from `hono.test.ts` to `fetch()`. The build re-measures
this section, 3.4.1's table, `check.ts` and `layout.test.ts` from the new
links, and writes the new numbers here.

### 3.2 Spacing

| Name | Value |
|---|---|
| Clearance | 8 between any two cards or labels, and between a drawn string (sampled, 3.4.4) and any card or label but its own two cards |
| Column gap | 160; 240 when 160 leaves links undrawn (3.4.1), and never wider |
| Cards stacked in a column | 48 apart; 58 when 48 leaves links undrawn even at a 240 gap (3.4.1) |
| Row under a band | its top 72 below the band's lowest card |
| Most a card drops | 400 below its band's top to sit level with the row that calls it (3.3.2) |
| Between bands | 96 from the lowest card of one band (the row under it included) to the top of the next |
| Bottom row | 96 below the last band; cards 48 apart, a test right after its card 160 apart; wraps at `max(2800, widest band)` |
| Card width | the longest kept line, 480 to 880; the PR card 640; a band's cards after column 0 take their column's width; column 0 lines up on the left |
| Card grid | header 56, rows 20, 12 below the last row |

### 3.3 Columns and rows

3.3.1 Each band starts at x 0. Column 0 holds the band's context card,
under the PR card in the first band, all lined up on the board's left edge,
so the board's left margin is straight; a context card's strings leave from
its own right edge. Later columns hold the cards at each call depth from
the entry, and every card in one of them takes the column's width, so
strings leave a column from one edge, clear of a wider card above or below.

3.3.2 **Order in a column.** Cards in a column stack in the order that
keeps strings short and parallel, as a person pinning them would: first
column by column, each card by the mean height of the rows that call it;
then four sweeps that order each column by where all its links pull its
cards, from both sides, keeping the order whose strings, as straight
lines, cross least. A card nothing pulls keeps its place.

**Heights.** Entries take the band's top; in the first band that is the
PR card's top. Context links never place a card. Every other card's top
sits 28 above a row that calls it, so its header's middle is level with
that row and that string runs flat: of the rows calling it no more than
400 below the band's top, the one nearest their mean. A card no such row
calls starts at the top, so a long chain of calls doesn't turn into a
staircase. Cards in a column are pushed down only as far as the 48 rule
needs.

3.3.3 A card in the row under a band goes centred under the mean of the
cards it links to; if no string clears from there, under each of them in
turn.

3.3.4 Nothing is grouped, so a click selects one card and Drawdy shows no
text controls. **A drag moves a card and the ends of its strings; nothing
else.** Drawdy moves only a string's bound end points and keeps its bend
points where they are (`updateBoundLines` in the host). The curve's
direction at a bend between two bends depends on those two alone, so after
any drag the string still passes through the bend its label sits by
(3.4.5) at the same angle, and the label still sits beside the string.

The trade-off: a card dragged far from its bends pulls its strings into a
kink near the card, since the first and last stretch now run from the
moved end to a bend that stayed (`hono-dragged.png` in the previews:
`compose()` moved 200 right). Re-routing them is not possible in DDP 1.3:
`update-drawdy-elements` sets style, meta, lock, group and position, not
an arrow's points or bends, and the only other way, removing and adding
the strings again, makes new undo steps (one for the drag, more for the
re-route) and gives the strings new ids. PR Blackboard moves nothing after a
drag: one drag, one undo step. Moving the card back puts its strings back.

### 3.4 Strings and labels

3.4.1 **What gets a string.** Links are routed shortest first, since near
links make the strings that read best. A link gets a string when:

1. one of its routes (3.4.3) clears every card but its own two by 8,
   makes no hook, and runs along no card's edge, any of the four, its own
   two cards included: closer than 24 to an edge for 120 or more, a
   string reads as the card's border and can't be told from its
   neighbours; of the routes that pass, the one crossing the fewest
   strings already drawn wins, the earliest of equals;
2. the board's strings, all told, still cross no more often than straight
   lines between the same ends would (strings that share an end meet
   there, which is no crossing: crossings within 24 of a shared end don't
   count);
3. it is one of the nearest three of its kind into its card. A card that
   many cards use, such as excalidraw#12237's `type PointerDownState`,
   used by ten handlers, gets its nearest three; seven more strings from
   across the board would only tangle.

Every other link is listed in the panel only. No route goes behind a card:
a string passing under a component is hidden by it, and the reader could
not tell where it goes. Cards are placed first and labels last (3.4.5), so
strings never give way to a label. When the compact board (columns 160
apart, stacked cards 48) leaves any link undrawn, it is planned again
roomier, first with 240 between columns, then also 58 between stacked
cards, which gives a gap a second lane; the plan that draws more strings
wins, then the one whose strings cross less, then the first tried. No
board is roomier than that (request 7). hono and the synthetic boards
stay compact. Measured with the four-edge rule:

| Board | Plan | Strings | Crossings (straight lines) | Labelled |
|---|---|---|---|---|
| excalidraw#12237 | 240, 58 | 33 of 46 | 28 (28) | 28 |
| elysia#1734 | 240, 48 | 17 of 27 | 11 (14) | 16 |
| bun#34519 | 240, 48 | 11 of 12 | 3 (3) | 11 |
| vite#23586 | 240, 58 | 13 of 13 | 8 (8) | 10 |

excalidraw's panel lists the other 13: 8 of the 10 `uses` into
`PointerDownState` (the far 7, and one of the nearest three that would
tangle), 3 of the 4 `calls` into `reset()` (the farthest, and two that
find no lane) and 2 long `calls`. Before the rule covered tops and bottoms it drew 34, four of
them pressed for 700 to 880 along a card's top or bottom; with 48 between
stacked cards those four had no lane, and the 58 stack gives three of
them one, 100 taller in all. Its steep strings, 240 across and up to 2000
high, leave and arrive level and climb in the middle of the gap instead
of along a card's edge; where even that is too close, the link goes to
the panel. That is the stress case's limit: a string 2000 high in a 240
gap is mostly vertical whatever its shape.

3.4.2 **Ends.** Strings into one edge of a card meet at one point, so
fan-in strings share their tip; each keeps its own arrowhead, arriving at
its own angle:

| Edge | Point |
|---|---|
| Left edge (calls, uses, imports from the left) | y + 28, the header's middle |
| Bottom edge (from the row under) | `anchorX 0.5` |
| Right edge (a flat test string in the bottom row) | y + 28 |
| Top edge (a back link, 3.4.3 R4) | `anchorX 0.5` |

A string **starts** at the row that makes the link (first changed call
row, else first call row) on the source's right edge, so the reader sees
which line calls; two links from one row start together and split. From
the row under, strings start at the card's top middle and split. In the
bottom row, a test string starts at the test card's left edge, y + 28.

3.4.3 **Routes.** The host draws a uniform Catmull-Rom spline through
`[start, ...bend, end]`, 20 steps a segment, through every point it is
given, so the bends make the curve. With `a` the start, `b` the end and
`d = b − a`:

| Route | For | Bends |
|---|---|---|
| R1 across | target right of source | three: `a + d·s`, plus a sag of `4s(1 − s)·sag`, at s = ¼, ½, ¾: a string pinned at both ends. Where that runs into the corner of a card beside an end, or along a card's side (3.4.1), the same with `d.y·S(s)` instead of `d.y·s`, so it leaves and arrives level and climbs mid-gap |
| R1' through | R1 blocked by cards between the ends | flat along a lane through each column in the way, curving between columns: one bend every 64 or so along that course (3.4.3.1) |
| R2 up or down | from the row under or the bottom row to a card above, or below | three: `a + (d.x·S(s), d.y·s)` at s = ¼, ½, ¾, top middle to bottom middle (bottom to top going down) |
| R3 flat | a test right after its card in the bottom row | as R1, leftward |
| R4 back | target left of source (a cycle) | over both cards, top middle to top middle: `(a.x − ⅛·abs(d.x), top − 48)`, `((a.x + b.x) / 2, top − 60)`, `(b.x + ⅛·abs(d.x), top − 48)`, with `top` the higher card's top; else the same under both, bottom middle to bottom middle |

`S(s) = 3s² − 2s³`, a smoothstep, which never overshoots: square leads (a
bend level with each end) would make the spline swing the wrong way
first. **Sag:** 8 % of the string's length, no less than 20 and no more
than 48, always downward, like string under its own weight. A 200-long
string hangs 20, a 600-long one 48: enough to read as a curve, not a ruled
line. Measured on excalidraw#12237, elysia#1734, bun#34519 and vite#23586,
this sag keeps check 6 (no more crossings than straight lines) on every
board; a deeper one (10 %, 24 to 60) cost excalidraw a string. The host's
renderer ignores `roughness` on lines and arrows (`drawGenericPath` in
`drawElement.ts`), so the hand-drawn look of request 23 comes from
geometry: the sag, and curves round cards.

3.4.3.1 **R1' lanes.** In each column between the ends (cards that overlap
in x), a string runs at a lane: in a gap between two stacked cards, at
least 24 from both, so a lane never reads as either card's border (one
lane in a 48 gap, its middle, and one more for every 10 over), or 24
above the column's top or below its lowest card, four there, 10 apart.
A lane more than 320 off the straight line between the ends would make a
long detour, so then the link has no R1' route. Three tries: each column's
nearest lane, then the nearest above the straight line in every column,
then below. The course runs level from 16 before a column to 16 after it,
eases between columns on the smoothstep, which starts and ends level, and
runs straight from the source and into the target, so strings that share
an end meet at their own angles. Its bends sit evenly along it, about 64
apart: Drawdy's curve through points that close follows the course.

Order: R1, then R1' (for a target right of the source); R2 from the row
under or the bottom row; R3 in the bottom row; R4 for a target left of
the source in a band. Links between the bottom row and a band try the
route their positions give (R1, R2 or R4). A route **hooks** when any
point of its curve runs more than 2 past either end along its main axis
(y for R2, x for the rest); a hooking route is never drawn.

There is no cap on strings per card but 3.4.1's three of one kind into a
card: strings from one card share their start and split.

3.4.4 **Style.** Width 2, no `roughness` and no `elbowRouting`. Dashed
when either end is a context card. **Colour** tells strings apart, from
eight hues (`STRING_COLOURS`), Okabe-Ito's, darkened where they were too
light, and a violet: violet `#9163d5`, orange `#da7f00`, bluish green
`#009E73`, blue `#0072B2`, reddish purple `#CC79A7`, mustard `#a79300`,
vermillion `#D55E00`, sky `#29a1c1`. Drawdy draws a hex colour as given in
both themes, so each was checked against both canvases: 2.7:1 or more on
the light one (`#f4f4f5`), 3.4:1 or more on the dark one (`#18181b`). The
violet comes first, since most strings get it and it reads best on both
(3.9:1 and 4.2:1); after it the hues that differ most, for colour-blind
readers too. None is the cards' diff green or red.

All the strings that leave one card share its colour: they start together
and split. Two cards conflict when a string of one crosses a string of the
other (3.4.1's rule for counting), meets it at one end, or runs within 12
of it for 60 or more. Colours go out greedily, the card with the most
conflicts first, then in board order, each card taking the first hue no
coloured neighbour has (when all eight are taken, the one fewest
neighbours have), so a pull request always gets the same colours. A
label takes its string's colour. hono#5513 has two colours; excalidraw
#12237 four, and no two strings from different cards that cross share
one: the only crossing strings with one colour leave the same card.

For clearance and for click hit-testing, a string is
the polyline the host draws: `catmullRomSpline([start, ...bend, end],
20)`, copied into `lib/` as a pure function; the preview draws with the
same function. Live points come back as `[start, end, ...bend]` (the end
is index 1, not the last).

3.4.5 **Labels.** 16 point, its string's colour, one word, no counts. A label sits beside a
bend whose neighbours are both bends, not ends: the curve passes through
that bend at an angle a drag can't change (3.3.4). With three bends that
is the middle one; an R1' string tries its bends from the middle outward.
Where the string is steeper than 45° there (its direction is the next
bend minus the one before), the label goes 10 to its right, else 10 to its
left; where it is flatter, 6 above, else 6 below, measured from the
stretch of the curve around the bend that the label spans. A label must
clear every card, label and other string by 8. A label that clears nowhere
is dropped; the string stays. excalidraw#12237 labels 28 of its 33
strings: the other five run where strings pass close on both sides.

3.4.6 **Merging, decided.** Strings join only where they share an end
point (fan-in at a target, fan-out from one row or one card top). They do
not share a trunk: a shared trunk needs bend points common to several
strings, which the host's curve can't keep coincident, and a reader could
no longer follow one string from end to end. Strings through one gap run
side by side, 10 apart, which reads as a bundle without losing any one
of them. A card that many cards link to the same way gets its nearest
three strings (3.4.1) rather than a merged trunk from everywhere.


## 4. Steps

4.1 **Order.** The PR card; then each band: its change cards column by
column, top to bottom within a column, then the row under it left to right;
then the bottom row. Context cards are not steps. Order is fixed when the
board is made.

hono#5513: PR card → `#dispatch()` → `#handleError()` → `compose()` →
`toError()` → `compose.test.ts` → imports → `onError()` →
`hono.test.ts`. Nine steps.

4.2 **Next, Previous:** the panel's chevron buttons, or `←` `→` while the
reading view has focus. A deleted card is skipped. From a context card,
Next goes to the first step after it in board order. The driver sends
`hasPrevious` and `hasNext`; the panel disables Previous or Next from
those alone.

4.3 **After pinning,** the PR card is current and the camera makes one
flight, to the overview. **Picking up** a board already pinned (6.3) leaves
the same state: the PR card current, position `1 / 9`, and the camera
where it is.

4.4 **Overview:** the whole board, centred in the usable view (6.4) at
the zoom that fits it, at most 1. The current card does not change. The
union comes from each card's `element-rects`.

## 5. Cards

5.1 **A change card** shows the first line, each changed line with 2
lines around it (deletions above additions), each row that calls another
card (`→` in the gutter), and folds between (`⋯ 23 lines`). A fold hides
2 lines or more: a single hidden line shows in its place, at the end too,
since its fold row would take the same room. Changed words are marked.
Past 24 rows plain context goes first and the last row reads `⋯ 18 more
lines · Read all`; rows that start a string stay. Every fold row opens
Read all at its lines, so each underlines what to click: its line count
(`⋯ 23 lines`), or `Read all` on the last row. The `⋯` is set in 15 px
sans, since the code font draws it as two faint dots. Every row that
opens Read all has this one shape: 11.5 mono `--ink3`, `⋯` at 112 from
the card's left (52 on a test card, so the text sits under the case
names), then what it hides, then `Read all` underlined.

5.1.1 **Nothing hidden without a way to it.** A card at its widest (880)
ends a long line in `…`. When it does and the card doesn't already end in
`Read all`, a last row says so, `⋯ 1 line cut short · Read all`, opening
Read all at that line: toError(), hono#5513's one new function, ends its
changed line 5 at `{ cause: err …` and gets this row. A test card always
ends in `Read all` (5.3), since it hides every test body. So a card hides
code exactly when its last row says `Read all`, on the board with the
panel closed too, and the panel offers `Read all` for exactly those cards
(7.3.2), and always for a PR card with a description, which a board shows
first at overview zoom.

5.2 **Header,** 56 high, the same on every card:

```
┌──────────────────────────────────────────────────────────────────────┐
│ compose()  [NEW]                       src/compose.ts · 18–77  +4 −3 │ 56
├──────────────────────────────────────────────────────────────────────┤
 14 pad, name 15 mono 600, chip only NEW / UNCHANGED / TESTS,
 path · lines 12 mono ink3 (ellipsis), +N −M 12.5 mono, 14 pad
```

A context card's counts stay off. Nothing on a card opens a page: DDP 1.3
can't open one, so a card has no link.

5.3 **Context card:** dashed border, no `+`/`−` gutter, at most 10 rows.
**Test card:** up to 12 case names, then `⋯ 4 more cases · Read all`, or,
when every case shows, `⋯ Test code · Read all`: the card lists cases,
and their code is only in Read all. The row gives no line count: the
header's `+66 −0` already says how much test code there is.
Each case row has its line number bare in the gutter, then `+` or `−`,
then the name; a group (`describe`) is bold, its cases indented 12.
**File card:** the file's excerpt, cut at 24 rows; unchanged lines between
two hunks read `⋯ 12 lines`. Cards are inert HTML; clicks arrive as
`scene:click` and are mapped on the fixed grid.

5.4 **Colours.** Each card fixes its colours to the theme Drawdy shows the
reader who pins it (`styling.theme`), recorded in the PR card's mark; Read
all takes the same theme. So a teammate in the other theme, or a reader
who switches theme, sees the cards as they were pinned: light cards on a
dark canvas, or dark on light. Opening the pull request again only flies
to the board (8.3); to pin it in another theme, delete its cards and open
it again. Re-pinning on every theme change would add undo steps to
everyone's history. The card surfaces (background, header) stay as
they are, since they must sit on Drawdy's board. The diff and syntax
colours become GitHub's (Primer), so code reads the same as on GitHub, on
cards, in description code blocks and in Read all:

| Token | Light | Dark |
|---|---|---|
| Added line / gutter / word | `#e6ffec` / `#ccffd8` / `#abf2bc` | `rgb(46 160 67 / .15)` / `rgb(63 185 80 / .3)` / `rgb(46 160 67 / .4)` |
| Deleted line / gutter / word | `#ffebe9` / `#ffd7d5` / `rgb(255 129 130 / .4)` | `rgb(248 81 73 / .1)` / `rgb(248 81 73 / .3)` / `rgb(248 81 73 / .4)` |
| Keyword, string, number, comment, function, type | `#cf222e`, `#0a3069`, `#0550ae`, `#59636e`, `#8250df`, `#953800` | `#ff7b72`, `#a5d6ff`, `#79c0ff`, `#9198a1`, `#d2a8ff`, `#ffa657` |
| Link, code block background, border | `#0969da`, `#f6f8fa`, `#d1d9e0` | `#4493f8`, `#151b23`, `#3d444d` |

The cards' layout already is GitHub's unified diff (two number columns,
`+`/`−`, tinted rows, marked words), so it stays.

5.5 **The PR card.**

```
┌ PR card, 640 ──────────────────────────────────────────────────────┐
│ [honojs/hono#5513]  Merged                                         │ header 56
├────────────────────────────────────────────────────────────────────┤
│ fix(hono): handle non-Error throws with onError                    │ title 20/26, 600, ≤ 3 lines
│ usualoma · 4 files · +202 −11                                      │ meta 12.5/20, 4 below
│ 28 functions and 2 files not pinned                                │ 20, only when some
│ ────────────────────────────────────────────────────────────────── │ 16, rule, 16
│ A value thrown from a handler or middleware that is not an `Error` │ Markdown 14/21
│ instance was rethrown as-is. It bypassed `app.onError()`, …        │
│                                                                    │
│ This PR handles non-Error throws the same way as Errors.           │
│                                                                    │
│  • `compose` and `Hono#handleError` wrap a non-Error value in an … │
│     ◦ `Hono#handleError` needs the same handling because a …       │
│  • `c.error` is now also set when an error is handled outside …    │
│                                                                    │ the blocks that fit whole
│ Behavior change                                                    │ in 500, never ending on a
│ A non-Error thrown from a handler no longer propagates out of …    │ heading
│ ⋯ Read all                                                         │ fold row 32, right under the text, only when blocks are left off
│                                                                    │ what the estimate gave over
└────────────────────────────────────────────────────────────────────┘ 16 padding
```

5.5.1 **Markdown.** The description renders as GitHub-flavoured Markdown
with GitHub's markdown-body styles: headings h1 to h6 (h1 and h2 with a
bottom rule), emphasis, strikethrough, lists and nested lists, task lists
(`☑`/`☐` boxes styled like GitHub's disabled checkboxes, never inputs),
links in the link colour without underline, inline code (`rgb(129 139 152
/ .12)` background, radius 6, 85%), fenced code blocks (code block
background, radius 6, padding 16, 12.5 mono, 20 lines, highlighted by the
cards' highlighter from the fence's language through `language.ts`;
`diff` fences tint `+` and `−` lines), tables (borders, bold header,
alternate rows tinted), blockquotes (4 px left rule, muted text) and
rules. GitHub alerts (`> [!NOTE]`, `TIP`, `IMPORTANT`, `WARNING`,
`CAUTION`) show as a quote that starts with the bold word (`Note`,
`Warning`, …). Inline code in the title renders as code too, on the card,
in the panel and on the example rows, as GitHub does. The panel has no Markdown
parser: the driver splits a title on backticks and sends it as
`{ text, code }[]` segments, and `SUGGESTIONS` ships its titles the same
way.

5.5.2 **Parser.** `marked` 18.0.9 (MIT, no dependencies) is vendored
unchanged as one file, `src/vendor/marked.ts`, with its licence header,
its version and `// @ts-nocheck`. The marketplace builds from the
repository with no `node_modules` and allows only
`@drawdy/driver-protocol` as a bare import (`DEFAULT_IMPORT_WHITELIST` in
the host's `extension-builder.ts`), so the whitelist stays exactly as it
is. `lib/markdown.ts` (pure) is the one typed door to it: it uses only
the `Lexer`, declares the few token shapes it reads, and renders the
tokens itself, so every tag it writes is one it chose and all text is
escaped. GitHub's emoji shortcodes show as GitHub shows them: `emojify`
turns a short fixed table of common names (`:tada:` is 🎉) into emoji in
titles and descriptions alike, never inside code, and leaves any other
`:name:` as written. Code fences use `language.ts` and `highlight.ts`; no other
highlighter. The marketplace does not minify, so check.ts builds with
`minify: false` and reports that size: about 236 KB with marked, limit
1 MB.

5.5.3 **Untrusted input.** No raw HTML or script reaches a card:

| In the description | On the card and in Read all |
|---|---|
| HTML comments (PR templates) | dropped |
| `<br>` | a line break |
| `<details><summary>X</summary>…</details>` | On the card, `▸ X` in bold and the body skipped up to the matching close tag, nested ones counted. In Read all, a real `<details><summary>`, so the reader can open it with no script |
| `<img>`, `![alt](url)` | a one-line grey chip `Image: alt` (or `Image`); nothing is fetched |
| A bare `github.com/user-attachments/assets/…` URL on its own line (an image or video GitHub would show) | the chip `Attachment` |
| Any other tag | dropped; its text kept and escaped |
| Entities (`&amp;`, `&lt;`) | shown as the character: `<`, `>` and `"` are always escaped, `&` only where it does not start an entity, as `marked`'s own `escape(text, false)` does |
| Links | link colour, inert: card iframes can open nothing |
| A description over 20 000 characters | cut there before the lexer runs, so a huge body cannot stall the driver |

Images are not loaded: a card is seen by everyone on the board, and
fetching a URL from a description would send every viewer's address to
any host the author chose (the README promises PR Blackboard sends nothing
else anywhere), and an image's height is unknown when the card's height
is fixed.

5.5.4 **Height.** A component's height is fixed when it is made, for
every viewer, and the driver cannot measure HTML, so
`markdownBlocks(tokens, 608)` estimates each top-level block from GitHub's
metrics: paragraph lines `ceil(chars × 7.2 / width)` at 21 plus 16 below;
list items indented 32 a level and .25em apart (in a loose list, each
item's paragraph 16 below the last); h1 40 + 24 + rule, h2 30 + 24 + rule,
h3 25 + 40, where a heading's or rule's 24 above collapses into the 16
below the block before it, and the first block has none; code blocks lines
× 20 + 32 + 16; table rows × 34 + 16; quotes their content + 16. The sum
less the last gap, plus 3 %, is the estimate: on every preview description
it is at or above Chrome's measure, by 2 to 8 % (9.2). A teammate's fonts
may still wrap longer, so the description area has `overflow: hidden`.
It takes the height Chrome gives it, at most the estimate (`max-height`),
and the fold row follows it, so `⋯ Read all` sits right under the last
paragraph; what the estimate gave over sits at the card's foot as padding.
One rule decides what the card shows:

| The whole description, estimated | The card shows | Fold row `⋯ Read all` (32) |
|---|---|---|
| up to 532 (500 and the fold row's own room) | all of it | no |
| over 532 | the blocks that fit whole in 500, never ending on a heading | yes |
| over 532, and not even the first block fits | 500 of it, cut inside, a 48 fade | yes |

Only the blocks shown are rendered, so nothing is cut halfway. The panel
offers `Read all` on the PR card whenever it has a description (7.3.2),
folded or not. hono's description (about
608 estimated) shows up to the "Behavior change" paragraph (472); the
excalidraw one (491) and the synthetic one-liner show whole.


## 6. Clicks, links and the camera

### 6.1 Listening

6.1.1 PR Blackboard subscribes to `scene:click`, `scene:elements-removed`,
`scene:elements-replaced` and `keyboard:control-keys` in `start()`, when
Drawdy starts it, not when the panel opens. `camera:moved-rapid` is
subscribed only while the popover is open (7.1) and removed when it
closes. Drawdy grants every declared permission at install (the connect
dialog, and shared board extensions), so in production these prompt no
one. Only a reader whose scene grant is unanswered (a dev server, or a
permission unticked at install) is asked once, on their first board
click. It acts only on the local reader's gestures. The
`scene:drawdy-elements-dragged` subscription is gone (3.3.4).

6.1.2 **The board index.** Every PR Blackboard element's mark (8.2) holds
what clicks need: a card's pin id, name, size when made and fold rows; a
string's link id, kind and both pin ids. A click costs one read:
`get-drawdy-elements` for the clicked ids with `meta`, `x`, `y`, `width`
and `height`. If none is PR Blackboard's, PR Blackboard stops there. The live
rect and the mark's size give the card-local height, so fold rows are
hit-tested from that one read. Only for a click that needs the links (a
string or a label) does PR Blackboard read that pull request's marks
(`readBoard`) and keep them as the index; a clicked mark the index lacks
(an undo brought a card back) rebuilds it once. Following a string and
the camera need no stored review and no GitHub request.

Navigator state is two parts: the **index**, built from marks alone
(pins by id with name, size and folds; links with kind, from and to;
labels; the theme), and an optional **review** that the panel and Read
all load (stored copy, else GitHub), only when Read all actually opens or
the panel needs it.

### 6.2 What a click does

`scene:click` lists every element under the point; PR Blackboard takes the
first of card, label, string. A string counts only within 10 / zoom of
its sampled curve (3.4.4). These work with the panel open or closed:

| Click on | What happens |
|---|---|
| A fold row (`⋯ 23 lines`, a last row saying `Read all`, the PR card's `⋯ Read all`), found from the mark's `folds` | The card becomes current, Drawdy's selection clears, and Read all opens at that row's line (7.1) |
| A string or its label | Follow it to its far end from the current card; when neither end is current, to the end it points at. The camera flies (6.4) |
| Anywhere else on a card | It becomes current: the panel shows it when open. The board and the camera stay. Read all closes unless the card was already current |

With the panel open on its start view (after `Open another`, or an
error), any of these clicks also brings back the reading view of the
clicked board (7.3.3).

A click on empty board does nothing: Drawdy sends no `scene:click` for
it, and Read all stays until `✕`, Esc, another card or a move (7.1.5).
`Esc` closes Read all while the board or the panel has focus; `✕` is
always there.

### 6.3 Coming alive without the panel

| Reader | What works on the board |
|---|---|
| Closed the panel this session | Everything in 6.2; the current card follows their clicks, and reopening the panel shows it |
| Reloaded, never reopened the panel | Everything in 6.2. Fold rows work from the clicked card's mark; the first string or label click builds the index (6.1.2). Read all loads the stored review (no GitHub request) |
| A teammate with PR Blackboard installed | Everything in 6.2, with no GitHub request until Read all opens. Then it loads the review from GitHub the first time (2 requests); meanwhile the popover shows the header and `Reading the pull request…`, and a failure shows there in the panel's words (`explain`). If the reader has clicked another card by then, that popover closes and nothing else opens |
| A teammate without PR Blackboard | Static cards and native strings: readable, nothing clickable |

What only the panel does: open a pull request (field, paste, example
rows), walk the cards in order (Previous, Next, position), the overview,
every link of the current card (drawn or not), Read all for any card from
one button, going back to the start view to open another, loading
progress and errors. Opening the panel
picks the board up (4.3) if no review is loaded yet. When it can't (a
teammate with no stored copy whom GitHub is limiting, or no network), the
start view shows why under the field, in the same words and slot as any
other error; the rate-limit line says when to try again.

### 6.4 Camera on a step or a follow

The usable view is the screen less Drawdy's toolbar (64) on top and the
panel's strip (392) on the right. Code is 12.5 px, so the camera never
goes below zoom 0.8. With the panel closed the strip is still left free:
the driver can't tell whether the panel is open, and Read all must clear
it when it is. Drawdy's minimap sits in the bottom-left corner (x 16 to
172, 134 high, 18 above the bottom on drawdy.io), so the current card
also keeps clear of a 196 × 168 corner there.

1. When the card and the cards its drawn strings join fit the usable view
   at zoom 0.8 or closer (24 px margin), frame them all, at zoom at most 1,
   provided the card can clear the minimap with all of them still whole.
2. Otherwise frame the card alone at the largest zoom from 0.8 to 1 that
   fits it with 160 of room each side (the room shrinking toward 0 when
   needed), centred when shorter than the view, else its top 24 px below
   the toolbar. Then the frame moves, as little as it can, to take in the
   names of the cards its drawn strings join, nearest first, while the
   card stays whole at 0.8 or closer.

Last, if the minimap's corner covers the card, the frame moves back the
least it takes to clear it, the card going right or up and staying whole.
The card wins over the names. A card too wide and too tall to clear the
corner at 1280 × 800 moves as far as staying whole allows.

The camera stays still when the card is already whole in the usable view
at zoom 0.8 or more and clear of the minimap. One flight, 450 ms. A click
on a card never moves the camera.

Before every move PR Blackboard makes (Next, Previous, a follow, the
overview, and the overview after pinning), it clears Drawdy's selection.
A card left selected would be a second "you are here" that disagrees with
the camera, and Drawdy's Layers/Actions toolbar for it would cover the
card just flown to. A fold-row click clears it too: it reads like a link,
and the toolbar would cover the board beside Read all. Any other click on
a card leaves Drawdy's selection alone: the reader may want to drag what
they clicked.

## 7. Read all and the panel

### 7.1 Read all, the one popover

7.1.1 Read all is the one popover, right of its card. It opens only from a fold row or the
panel's `Read all`. Contents: the whole declaration for a change
or context card; the file's diff for a test or file card; for the PR card,
its header, title, meta and the whole description (5.5), uncut. Unified,
wrapped, changed words marked, scrolled to the folded lines or the first
change. Rows that call another card carry the `→`, as on the card.

7.1.2 **Always right of its card:** a floating overlay, root
`pointerEvents: "auto"`, width `clamp(usableWidth − 260, 520, 720)`, height
`min(640, usableHeight − 48, page)`, left edge 24 px right of the card, top
level with it, kept in the usable view. `page` is the page's height at that
width, estimated as the PR card's description is (`ReadAllPage.height`):
the 56 header, 20 a row and 12 below the last, a code line counting one
row more for each time it wraps (7.6 px a character in the code column,
continuing under its indent plus two); for the PR card, the title, meta
and description at the page's width, or the full height when the
description has a `<details>`, which the estimate counts as its summary.
So `toError()`, two lines, opens 128 tall instead of 640; a long page
keeps 640 and scrolls. Without room the camera first pans left,
keeping zoom and at least the card's right 240 px. While it is open it
follows `camera:moved-rapid`, subscribed on open and removed on close.

7.1.3 **One page and `✕`.** The iframe fills the overlay. Its page opens
with the card's own header, sticky. One schema button sits in a row of no height before the iframe,
drawn over the header's right end, which keeps 56 px free: `✕`
(`CLOSE_BUTTON`). Colours come from the cards' palette in the pinned
theme. The page's only script scrolls the focus a third of the way down,
snapped to a whole row.

7.1.4 A wrapped line continues under its own indent plus two columns.

7.1.5 Closes on `✕`, `Esc`, a click on another card, Next, Previous, a
follow or Overview. A click on empty board leaves it open: Drawdy reports
none, so no rule could make it close every time.

```
 board                    screen overlay, 520 to 720 wide
┌ compose() ─────────┐    ┌───────────────────────────────────────────────┐
│ …                  │    │ compose()  src/compose.ts · 18–77 +4 −3     ✕ │  the card's header, sticky
│ ⋯ 16 lines·Read all│ 24 ├───────────────────────────────────────────────┤
└────────────────────┘ px │ 52  55        } catch (err) {                 │
                       ──▶│ 53      −       if (err instanceof Error && … │
                          │     56  +       if (onError) {                │
                          │     57  + →       const error = toError(err)  │
                          └───────────────────────────────────────────────┘
```

### 7.2 The panel (request 32)

The whole panel follows the request-32 design (`SCRATCH/panel32`), with
request 39's `Open another` and request 41's icons: one paste field, one
error slot, example rows with project-coloured tags, a loading view that
shows the tag, and a reading view of four rows ending in `Open another`,
which goes back to the start view. `PANEL_CSS` is the design's `panel.css`; colours
come from Drawdy's theme vars, which load first, so no rule carries a
fallback. Drawdy's frame gives the panel 320 × 500 and names PR Blackboard,
so the panel has no title of its own.

```
 start                              reading
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ 🔗 Paste a GitHub pull req…  │   │ [honojs/hono#5513] +202 −11  │ tag, counts, state
│ (error, when there is one)   │   │   Merged                     │ wrap; the tag is never cut
│ [honojs/hono#5513]           │   │ fix(hono): handle non-Error  │ title, two lines at most
│ fix(hono): handle non-Erro…  │   │ throws with onError          │
│ [prettier/prettier#20127]    │   ├──────────────────────────────┤
│ Support configuration file…  │   │ Overview        <  4 / 9  >  │ nav, 46: Lucide chevrons
│ [colinhacks/zod#6652]        │   ├──────────────────────────────┤
│ fix(v4): check array, set …  │   │ compose()          Read all  │ name, chip, Read all
│ … 13 rows; the list alone    │   │ src/compose.ts · 18–77       │ plain path
│   scrolls, shadows while     │   │ called by  #dispatch()       │ kind once, then each card
│   rows are hidden            │   │ tested by  compose.test.ts   │
│                              │   │ calls      toError()         │
│                              │   ├──────────────────────────────┤
│                              │   │ Open another                 │ back to the start view
└──────────────────────────────┘   └──────────────────────────────┘
```

7.2.1 **Paste field,** at the top of the start view: 32 high, radius md, 1 px
`--drawdy-border` on `--drawdy-surface`, a 14 px Lucide `link` at left 10,
typed text 12 mono, placeholder 13 sans muted; focus gives a ring-coloured
border and a 1 px ring shadow. `inputmode="url" enterkeyhint="go"`,
`aria-label="GitHub pull request link"`. No button: a paste opens at once,
and so does Enter; only the driver's parser decides what is a GitHub pull
request. Placeholder: `Paste a GitHub pull request link`. No `<form>` (the
webview sandbox has no `allow-forms`).

7.2.2 **Error,** one slot under the field, the only place errors show
(request 39): padding 8 10, radius md, `--drawdy-destructive` at 14 %,
12.5/17. A failed open, or any action that fails, goes to the start view
with the link kept; typing hides the error; success clears the field. The words:
`Only GitHub pull request links work, like github.com/owner/repo/pull/123.`,
`GitHub can't find this pull request. Check the link: PR Blackboard opens
public pull requests only.`, `This network has used GitHub's 60 requests
for this hour. Try again in 12 minutes.`, `Couldn't pin the board. Try
again.` Any other failure of an action shows there too.

Two more come with the parser (2.2.2), and both pin nothing:

- `Couldn't download the TypeScript parser from cdn.jsdelivr.net. Try
  again.` for a failed download or a file whose SHA-256 is not its pin,
  one line for both. The host is named because a network that blocks it
  is the likely cause. The console gets the reason: the HTTP status, or
  both hashes.
- `Couldn't parse this pull request's TypeScript.` when the parser won't
  load or run. No "try again": the same input fails the same way. The
  console gets the error.

The language part names what was needed: `TypeScript parser` (the
`typescript` or `tsx` grammar), `JavaScript parser`, or `TypeScript and
JavaScript parsers`; `pull request's TypeScript`, `JavaScript`, or `code`
when both. A retry in the same session reuses the pull request and file
list already read, so it costs no GitHub request.

7.2.3 **Start view:** padding 14 14 0, gap 10: the field, the error, then
the 13 example rows with no heading (requests 38 and 40), in the
operator's order: honojs/hono#5513 first, whose board shows the strings
calmly, then prettier/prettier#20127, colinhacks/zod#6652,
vitejs/vite#23586, nodejs/node#63047, TanStack/router#8573,
withastro/astro#17955, sveltejs/svelte#18736, elysiajs/elysia#1734,
oven-sh/bun#34519, sindresorhus/ky#823, excalidraw/excalidraw#12237, and
last oven-sh/bun#30412, the Rust rewrite the owner asked for. Every
example is by the project's creator or a member of its core team, merged,
with its head commit still readable (requests 27, 28 and 40); the rule
sits on `SUGGESTIONS` in `src/shared/suggestions.ts` too, so later changes
keep it. Each draws strings on the board; mattpocock/skills#783 is gone
(the owner: "too stupid easy"). The titles ship there exactly as GitHub's
API gives them, so the start view costs no GitHub request. PR Blackboard keeps
no list of opened pull requests. Row 13 ships only with request 40's
big-PR fixes: its board must show its Rust.

7.2.4 **Example rows** (request 29): each a button, the tag on a line of
its own, first (request 26), then the title, 13/18 in the foreground, so
every title starts at one left edge. Grid, gap 4, padding 6 8, radius 8;
rows 2 apart; the list has margin 0 −8 so the text lines up with the
field; hover `--hover` (the foreground at 7 %). Inline code 11.5, padding
0 3, line height 1, so lines stay 18; `:tada:` shows as 🎉 (5.5.2). Only the
list scrolls, and its shadows, in `--shade` (the foreground at 16 %), show
only while rows are hidden.

**The cost, before the open** (request 40). A row whose pull request
costs more than the usual 2 GitHub requests says so on its tag line,
after the tag: 11/16 sans, muted, `23 of 60 GitHub requests`. Only
oven-sh/bun#30412 does (1 for the pull request, 22 pages of 2,188 files).
`SUGGESTIONS` ships each row's file count, and the cost is `1 +
ceil(files / 100)`, so nothing is fetched to show it. A pasted link's
cost shows once known, in the loading view (7.2.6).

```
│ [oven-sh/bun#30412]  23 of 60 GitHub requests │
│ Rewrite Bun in Rust                           │
```

7.2.5 **Tags:** 11/16 mono, padding 0 6, radius 999, 1 px border. Neutral:
muted text, `--drawdy-border`. An example project's tag (`.tag.hue`, `--c`
inline) takes its colour (request 36): text `color-mix(in oklab, var(--c)
60%, var(--drawdy-foreground))`, border `--c` at 40 %, fill at 10 %. The
repository picks the colour (`projectColour`), so any honojs/hono pull
request has an orange tag while loading and reading; other repositories
stay neutral. These are not the string colours (3.4.4).

Thirteen rows share the hue circle, so a brand colour stays only where it
is clear of the rows next to it; otherwise the row takes a free hue.
Contrast is computed for text on its fill over Drawdy's backgrounds
(`#ffffff`, `#1f1f23`): 5.7:1 or more at rest and 5.0:1 or more on hover,
in both themes (`SCRATCH/links-ux/tags.py`). Hue is OKLCH.

| Row | Project | `--c` | Hue | Source |
|---|---|---|---|---|
| 1 | honojs/hono | `#E36002` | 46 | hono.dev brand |
| 2 | prettier/prettier | `#41A0A1` | 196 | the teal of Prettier's logo, `#56B3B4`, darkened to 5.9:1 in light. Its red `#EA5E5E` sits next to hono's orange |
| 3 | colinhacks/zod | `#3A6AFF` | 266 | gradient start of Zod's `logo.svg` |
| 4 | vitejs/vite | `#BD34FE` | 311 | Vite's logo |
| 5 | nodejs/node | `#5FA04E` | 139 | Node's logo |
| 6 | TanStack/router | `#0891B2` | 222 | a free hue: Router's green `#39AF46` is 6° from Node's, the row above |
| 7 | withastro/astro | `#F041FF` | 325 | end of Astro's gradient |
| 8 | sveltejs/svelte | `#FF3E00` | 34 | Svelte's logo |
| 9 | elysiajs/elysia | `#F06292` | 2 | elysiajs.com |
| 10, 13 | oven-sh/bun | `#A67F38` | 80 | Bun's logo, darkened; both rows, never next to each other |
| 11 | sindresorhus/ky | `#288DD4` | 245 | a free hue |
| 12 | excalidraw/excalidraw | `#6965DB` | 281 | Excalidraw's logo |

Rows next to each other are at least 32° apart in hue (svelte and elysia,
which also differ in lightness) or 0.11 apart in OKLab (ky and
excalidraw, as before).

7.2.6 **Loading:** padding 14, gap 14: the tag of the pull request being
opened (known from the link), then the steps 10 apart, each with a 16 px
Lucide mark: `circle` in `--drawdy-border` to do, `loader-circle` in lime
turning (still under reduced motion), `circle-check` done, its circle
filled lime and its tick in `--drawdy-primary-foreground`, so the tick
reads on lime in both themes. The marks come from `<template>`s in the
markup, since the serialized panel script draws no SVG of its own.

```
 first open of a TypeScript pull request      every later open
┌──────────────────────────────────────────┐  ┌──────────────────────────────┐
│ [honojs/hono#5513]                       │  │ [honojs/hono#5513]           │
│ ✓ Reading the pull request               │  │ ✓ Reading the pull request   │
│ ◌ Downloading the TypeScript parser      │  │ ◌ Reading 4 changed files    │
│   · first time only                      │  │ ○ Pinning 10 cards           │
│ ◌ Reading 4 changed files                │  └──────────────────────────────┘
│ ○ Pinning 10 cards                       │
└──────────────────────────────────────────┘
```

1. `Reading the pull request`. When the file list takes more than one
   page, a muted suffix gives the cost once the pull request has said how
   many files it has: `· 23 GitHub requests` (request 40; oven-sh/bun#30412
   is the one example this applies to, and its row says so before the
   open, 7.2.4).
2. `Downloading the TypeScript parser`, then a muted `· first time only`,
   only when bytes come over the network: the first pull request in each
   language, or after a pin changes. The parser's name follows 7.2.2
   (`JavaScript parser`, `TypeScript and JavaScript parsers`). No size: the
   step's job is to say why this open is slower, once; the README gives
   the size. It starts when the file list is known and runs beside step 3,
   so both can turn at once; each is done on its own. A stored copy's check
   (8 to 30 ms) shows nothing.
3. `Reading 4 changed files`, turning for the whole step, imported files
   and parsing included. No counter: excalidraw#12237's 230 raw requests
   take about 3 s. If a live check of a shipped example passes 5 s, the
   step gains a muted count of files read so far, `· 120 files`; the
   total is not known ahead, since imports are found as files arrive.
4. `Pinning 10 cards`.

A failure ends the loading view: the start view comes back with the link
kept and the error under the field (7.2.2). A teammate's Read all that has
to build the review (6.3) shows only `Reading the pull request…` in its
popover, download or not.

7.2.7 **Icons** (request 41): every icon is Lucide 1.53.0 (ISC), inlined
from `src/shared/icons.ts` on Lucide's 24-unit grid with its 2-unit
stroke: `link` in the field, `chevron-left` and `chevron-right` for
Previous and Next, `circle`, `loader-circle` and `circle-check` while
loading, `x` for Read all's close button (an image of the SVG, since a
schema has no SVG node, stroked in the pinned theme's ink). The
extension's own icon is the one exception: a generated image (request
43), `assets/icon.png` for the listing and its 64 px copy as a PNG data
URI in the 20 px action button. Only Next's chevron changes the stroke, to 2.5, so it holds its weight on
lime. Text that is not an icon stays text: `+N −M`, `–` in `– / 9`, the
state pill, the cards' `→` and `⋯`.

### 7.3 The panel: reading

A grid of four rows:

7.3.0 **Header,** padding 12 14, gap 6: the tag, `+202 −11` (11.5 mono,
the cards' green and red for the panel's theme) and the state pill (11/18
semibold, white on GitHub's colours) in one left-flowing, wrapping row:
under a long tag the counts and pill wrap together, and the tag is never
cut. The title, 13.5/18 semibold, two lines at most, inline code as code.
Every count the reader sees groups its digits, here, on the PR card and
in the PR card's not-pinned line: `+1,009,257 −4,024`, `2,188 files`
(request 40). The file count is the pull request's `changed_files`, never
the length of the capped file list.

7.3.1 **Nav,** 46 high, borders above and below: `Overview`, a spacer,
Previous, the position, Next. Buttons 30 high, Next lime; the chevrons
16 px; the position 11.5 mono, `4 / 9`, or `– / 9` on an unchanged card.
Tooltips `Previous (←)` and `Next (→)`. The driver sends `hasPrevious`
and `hasNext`; the panel disables Previous and Next from those alone.

7.3.2 **Current card,** padding 12 14 0, gap 2. The name row: the name (13
mono semibold), its chip right after it, and `Read all` (26 high, 12) at
the right, shown only when the card hides something on the board: a fold
row, a test card's bodies or a line cut short (5.1.1). Then its path and
lines, plain 11.5 mono muted.

The PR card, current wherever a board lands, has no name, path or
links: the header above already names the pull request. Its block always
holds one row: the muted word `Description` (12 sans, at the name row's
left) and `Read all` at the right, so the button says what it opens. This
is the one card that offers `Read all` when nothing is folded: a board
lands at the overview, where the PR card is too small to read, and
without the row the card area under the nav stood empty from the nav to
`Open another`, which read as a board that had failed to load (live,
excalidraw#12237, whose description shows whole). When the pull request
has no description, the row holds the muted line `No description
provided.`, GitHub's words, and no button.

```
 the PR card current, as every board lands
┌──────────────────────────────┐
│ [excalidraw/excalidraw#12237]│
│ +1,617 −994  Merged          │
│ feat(editor): alt-click to … │
├──────────────────────────────┤
│ Overview        <  1 / 32  > │
├──────────────────────────────┤
│ Description         Read all │ always, unless there is no description
│                              │
├──────────────────────────────┤
│ Open another                 │
└──────────────────────────────┘
```

Every other card then lists its links: a grid of the kind word (12
muted) once per kind, then one row per linked card, a 12 mono button
underlined in `--drawdy-border` with a hover fill, which follows the link.
Kinds in this order: `called by`, `used by`, `tested by`, `imported by`,
`calls`, `uses`, `tests`, `imports` (no `mentioned in` or `mentions`:
that kind is gone, 2.2.6); a context card's link takes `calls` or `uses`
by 2.2.6. Names in board order (`review.order`), every resolved link
drawn or not, and nothing else: an uncertain link is not listed. Names and
paths break at camel humps and after `/` (`<wbr>`). Only the links scroll.
Chips keep the board's colours, but `TESTS` text is the background colour
(white on `#8aa4ff` would be 2.4:1 in dark) and `UNCHANGED` text the
foreground; `themeCss` gives the panel `--add`, `--del`, `--add-gut` and
`--blue` from the cards' palette.

7.3.3 **Open another** (request 39): the last row, border on top, padding
8 14 10, holds one quiet button, `Open another`: 28 high, 12.5 muted, no
border or fill, its text level with the panel's left edge; hover fills
`--hover` and darkens the text. It sends `start`: the driver shows the
start view, error cleared, and the paste field takes focus, ready for a
paste. The board stays on the canvas and the camera stays. Nothing in the
start view leads back, and nothing needs to: a click on any card, label
or string of a board on the canvas brings back the reading view for that
board (6.2), and so does reopening the panel. Reopening a pull request
already on the board flies to it, silently.

7.3.4 **Keys:** `←` and `→` step, `Esc` closes Read all, while the
reading view has focus. Tab: Overview, Previous, Next, Read all, the link
names, Open another.

7.3.5 **Messages** from the panel: `ready`, `open`, `start`, `next`,
`previous`, `overview`, `follow`, `read-all`, `close`.

## 8. Loading and marks

8.1 The whole board is one `add-drawdy-elements` call: one undo step, and
every string is added with both cards it binds. If the call fails, nothing
is on the board and the panel shows `Couldn't pin the board. Try again.`

8.2 Every element carries `meta.prBlackboard`: the PR, the head commit, the
part (`pr`, `pin`, `link`, `label`) and:

| Part | Also holds |
|---|---|
| `pr`, `pin` | `pin`, `name`, `width`, `height`, `folds`; the PR card also `theme` |
| `link` | `link`, `kind`, `from`, `to` (pin ids) |
| `label` | `link`, `pin` |

`folds` is `[y, line][]`: each fold row's card-local top (rows are 20
high) and the line Read all scrolls to, 0 for the first change. The PR
card's `⋯ Read all` is `[y, 0]`, where `y` is the row's estimated top less
a tenth of the description's room, since the row follows the description
as Chrome lays it out (5.5.1); a click from there to the card's foot
opens Read all. One strict reader (`markOf`) takes these
marks; anything else is not PR Blackboard's. PR Blackboard hasn't shipped, so no
earlier mark shape is read (request 32).

8.3 Opening a pull request already on the board at its head commit flies
to its overview, silently: the camera shows it is there. A board at an older commit is another board: the new one goes in
free space beside it.

8.4 **Stored reviews.** One shape, `REVIEW_VERSION` 7; a stored copy of
any other version is fetched again. Nothing is migrated.

8.5 **Edge cases.** No readable declarations: file cards joined by
`imports` strings. Only docs or config: the PR card and one row of file
cards. A diff GitHub left out: a file card with an info row. An empty
description: no rule and no description, the card ends after the meta. A
moved card: its string ends follow, bends and labels stay. A deleted
card: Next skips it; its unbound strings stay.

## 9. Fixtures and previews

9.1 `npm run preview:board` renders hono, the synthetic boards and
excalidraw#12237, light and dark, from the real plan and element schemas.
Strings are drawn exactly as the host draws them: the `lib/` copy of its
Catmull-Rom through `[start, ...bend, end]`, the arrowhead along the last
spline segment, no roughness. It adds: the PR card close-up for hono and
excalidraw at 1920 (`hono-1920-pr.png`, `excalidraw-1920-pr.png`), Read
all on each PR card and on `toError()` (`hono-1920-toerror-read-all-dark.png`,
as short as its two lines), `excalidraw-overview.png` and
`excalidraw-overview-dark.png`, `hono-dragged.png` (`compose()` dragged
200 right: its string ends move, its bends stay, 3.3.4), and the panel's
states: the start view with its 13 example rows, loading (also the
first run, with the download step), reading in both themes (also the PR
card current, its description shown whole), a failure under the field,
and both parser errors; `panel-another-dark.png` and
`panel-another-light.png` show the start view as `Open another` leaves
it, the field focused. Step close-ups and the landed view draw Drawdy's
toolbar and a minimap placeholder in its bottom-left corner, so a card
under the minimap shows. For each board it prints the drawn and undrawn
link counts, the number of string crossings against straight lines
between the same ends (3.4.1), the colours used, and how many crossing
pairs share a colour (3.4.4). `npm run preview:board -- <dir>
<saved.json> …` adds, for each pull request saved in the fixtures' shape,
its overview and PR card: how the examples were checked without making
them fixtures.

9.2 The preview measures each description in Chrome at the PR card's
width, whole and as the card shows it, and prints both beside the
estimates (5.5.4).

9.3 The synthetic boards gain one description with every Markdown block
of 5.5.1, raw HTML, an image, a `<details>` and a `<script>`.

9.4 **excalidraw#12237 fixture:** fetched once, with 2 GitHub
requests (the pull request, its files with `?per_page=100` so a second
page never counts, and nothing else from the API; head
files from raw.githubusercontent.com), saved as
`src/lib/fixtures/excalidraw-12237.json` in the hono fixture's shape
(`source`, `pull`, `files`, and `raw`, 2.2.8). Excalidraw is MIT; the README
credits it beside Hono.

## 10. Cut list

| Removed | Why |
|---|---|
| Board title text | The PR card names the pull request |
| `starts here` string, `← from the pull request` row | The PR card is step 1, left of the first entry, level with it |
| Link rows in every card | Strings show drawn links, the panel lists all |
| `×3` in labels | The card's `→` rows show each call |
| Lime ring on new functions | The `NEW` chip says it |
| `CHANGED`, `FILE` chips, file-colour dots | Changed is the default; the header names the file |
| Extra context cards, unchanged callees | One caller shows who is affected |
| Lane labels | Bands, `tests` labels and `TESTS` chips show the groups |
| 136 note lane, Add note | Drawdy has its own sticky notes |
| Change counter, `↑` `↓`, `j` `k` | It moved the lime bar, which is gone |
| Read all: Function/File, Unified/Split, Wrap, change arrows, footer | One view per card kind; it opens at the change |
| Panel outline, seen ticks, `MAX_CHIPS`, stats line, key hint | The board is the map; the links block scrolls |
| `Home` key, right-click menu | Each repeats a panel button |
| PR card file list, tests bar, commits, branches | Cards name their files |
| 48-card and four-thread caps, `N more files` card | One 32-card limit; the PR card counts the rest |
| Camera strip, slide and side rules; zoom 0.6; batches; v1 and v2 readers | Two camera rules; one add call; one strict reader (`markOf`) |
| Red imports in files mode; tests strings by file name | A string must be a fact |
| The highlighter (glow, then rails) and its redraws | The owner asked for none |
| Recent | The owner asked for none; stored reviews stay |
| Straight-only strings, and links left to the panel because no straight line cleared | Straight strings tangle on excalidraw#12237; strings now curve round cards through lanes in the columns |
| Square leads (`h`), `roughness 1` | Square leads make the host's spline hook at both ends; the host ignores roughness on arrows. Smoothstep bends and a sag replace them |
| End spread over the header band, one shared arrowhead | Strings into one edge share one tip and keep their own heads |
| The 3-string cap from the row under | Strings from one card share their start and split |
| `followLabel`, `dragStart`/`dragEnd`, the drag subscription, the label move after a drag and its undo step | Labels sit by the middle bend, which the curve keeps passing through |
| `plainSummary` and the 8-line plain summary | The description renders as Markdown, as GitHub shows it |
| The 520 PR card with its `repo` row | 640 wide, with the header every card has |
| `watch()`: scene subscriptions only after the panel opens | The board must work without the panel |
| `camera:moved-rapid` for the whole session | Needed only while a popover is open |
| The panel's plain `owner/repo#n` labels and Try rows without titles | One chip for a pull request everywhere; Try rows show titles (request 25) |
| `minify: true` in check.ts | The marketplace builds unminified; check measures what ships |
| R1' detours with one middle bend, "over the top of every column, under the lowest", and column gaps of 320 and 400 | Long detours bunched over the column tops and doubled the crossings (156 against 81); lanes through the columns, a 240 gap at most and the crossing rule (3.4.1) replace them |
| Smoothstep as every R1 string's shape | Strings into one point arrived level and crossed at the tip; a straight string with a sag meets at its own angle. Smoothstep stays for a string that must clear a card's corner |
| Drawing every link that has a clear route | It drew ten strings from across the board into one type; the nearest three of a kind and the crossing rule keep the board readable, and the panel lists the rest |
| Right-aligned column 0 | The PR card stood 33 in from the board's left edge |
| `Start with #dispatch() ›` in the panel | It did what `›` does |
| `⋯ 1 line` folds | A fold row as tall as the line it hides |
| `Read all ›` on cards with no fold row; the PR card's fold row from 360 on; the `›` in `Read all` | Read all would show what the card shows; the description is cut at whole blocks and folded only when blocks are left off; `›` means Next |
| Line patterns and name matching for TypeScript and JavaScript (JS patterns kept only for `.vue`, `.svelte` and files the parser can't read), `mentions` and its cap, `uses` and `tests` for other languages, tests linked by the names their added lines carry, files-mode tests by the imports in their diff | 51 of 162 links were wrong on the scored pull requests; the parser's resolved references drew none wrong (2.2) |
| Uncertain links (members matched by name, imports named like a changed file) | A string must be a fact; a model may settle them later, and nothing is built for that now |
| Links to GitHub: `↗` on every card and in Read all, the panel's tag and path as buttons, the link to copy, `command:dom:open-url`, `sha256.ts`, `links.ts`, URLs in marks | DDP 1.3 can't open a page, and copying a link by hand was odd (requests 34 and 35). They wait until Drawdy lets an extension open a URL |
| Mark versions, the loose guard for earlier boards, `Laid out again beside the earlier version.` | PR Blackboard hasn't shipped: no earlier board exists (request 32) |
| Colour by kind (red calls, blue tests, ink imports) | Nearly every string was red on excalidraw#12237; colour now tells strings apart and the label gives the kind (request 31) |
| The `Try` heading, the tag inline before the title, muted titles | The rows ran together and wrapped back under the tag (requests 29 and 38) |
| The reading view's paste field (`another-url`, `another-error`) and its examples popover (`#pop`, `This board stays on the canvas.`) | `Open another` goes back to the start view (request 39) |
| The start view's `Open` button, the panel's paste check, the toast and its timer, the low-quota line, `←`/`→` in link rows, the tag's cut and `LONG_LABEL`, the `Next: name (→)` tooltip and `nextName`, `var(…, fallback)`, `.muted`, `.small`, `h3` | The request-32 design: one field that works one way, errors by the field, the camera already shows "already on the board", the rate-limit error says when to retry, the words give direction, the counts wrap instead, `hasNext` is all `›` needs, the theme loads first |
| The PR card's description cut at 480 inside a block | It could end on a heading with nothing under it |
| vitejs/vite#23463 among the examples | Its author is not on the Vite team (request 28) |
| mattpocock/skills#783 among the examples, with its teal tag | The owner: "too stupid easy"; its board drew no strings (request 40) |
| An empty card area under the nav when the PR card is current and its description shows whole | It read as a board that failed to load; the PR card always offers `Description` and `Read all` (7.3.2) |
| `mentioned in` and `mentions` in the panel's link list | The kind is gone (2.2.6) |
| A note, count or legend for links left out | A string is a fact; the panel lists every resolved link and nothing else (2.2) |
| A size or a counter on the loading view's download step | Its job is to say why the first open is slower; the README gives the size |
| Lucide `presentation` as the extension's icon | A generated image replaces it (request 43) |
| A sag of at most 16 | On a 700-long string it bowed 2 %, which reads as a ruled line; 8 % of the length, 20 to 48, reads as string (3.4.3) |
| Steep strings straight along a card's edge | Pressed against a card, a string read as its border; it now climbs mid-gap or goes to the panel (3.4.1) |
| Read all only from fold rows | Test cards and lines cut with `…` hid code with no way to it; every card that hides code now ends in `Read all` (5.1.1) |
| The PR card's name row, `The pull request`, in the panel | It repeated the header right above it |
| `Navigator.index`, `reviewOf` beside `reviewFor`, the key-to-link rewrite, `Review.steps`, the navigator's second `planBoard` | One `reviewAt`; a key already reads as `owner/repo#123`; `review.order` holds board order and `stepsOf` derives the steps |

### 10.1 Code that goes

- `layout.ts`: `followLabel`; `LAYOUT.endBand`; `LAYOUT.caps.underFrom`
  and its cap; `spreadEnds` and the two-pass first/survivors spread;
  `LAYOUT.label.offset`, `LAYOUT.label.near` and the start-relative label
  candidates; `PlannedString.a`/`b` as straight ends; the header comment
  "A string is a straight arrow". Their tests in `layout.test.ts`.
- `navigator.ts`: `dragStart`, `dragEnd`, the `Dragged` type and
  `dragged`, their `Navigator` members, the `followLabel` import, and the
  `current === "pr"` guard in `openReadAll`. Their tests in
  `navigator.test.ts`.
- `runtime.ts`: `watch()`, `watching`, the
  `subscription:scene:drawdy-elements-dragged` subscription and its case.
- `board.ts`: `stringsOf`'s straight `{from, to}` end pick; it samples
  `[start, end, ...bend]` instead.
- `elements.ts`: `roughness` on arrows.
- `model.ts`: `plainSummary`, `Review.summary` and its assignment, its
  test; `summary` in layout's `Plannable` and card's `PrCardInput`.
- `card.ts`: the PR card's width 520, `summaryLine`, `summaryChars`,
  `summaryMax`, the summary lines in `prCardSize`, the `.summary` rule and
  `<p class="summary">`, the repo row; the layout test's
  `"The pull request": [153, 0, 520]`.
- `docs/development.md` and this spec's history: passages on
  `followLabel`, labels moving after a drag, roughness and square leads.
- `layout.ts` (round 2): the R1' `tries`, `level` shapes and over/under
  candidates, `mid`, `LAYOUT.detour.tries`, `MIDDLE_POINT`, the gaps 320
  and 400, the right-aligned `xOf`, `wanted`'s first-caller rule.
- `read-all.ts`: `READ_ALL_BUTTONS` (now `CLOSE_BUTTON`), the `↗` button;
  `navigator.ts`: `githubFromPopover`; `runtime.ts`: its subscription and
  case; `card.ts`: `READ_ALL_BUTTON_ROOM` (96, now 56 inside the page),
  `LINK_PAGE_HEIGHT` (now `linkPageHeight`), `PR.whole`.
- `panel.ts` and `markup.ts`: `#begin`, `.begin`, its handler; the copy
  block, `#pr-chip` as a button, `#card-where` as a button, the `Try`
  heading, `.foot` and `#another` as a link, `.link`, `.prs-box`.
- Links: `lib/links.ts`, `lib/links.test.ts`, `lib/sha256.ts`; in
  `ddp.ts` `OpenUrlCommand` and `openUrl`; in `card.ts` `onGithub`,
  `CARD.github`, `.gh`, `linkPageHtml`, `linkPageHeight`, `linkScript`,
  `namedHeader`; in `navigator.ts` `showLink`, `urlOf`, `IndexPin.url`;
  in `runtime.ts` `openOnGithub`, `copy`, `act`; in `protocol.ts`
  `PanelView.copy`, `pr.url`, the `github` and `start` messages; in
  `read-all.ts` the link kind, `LINK_WIDTH` and `PopoverContent.kind`; in
  `view.ts` `placeReadAll`'s `size`; the mark's `url`; in the fake host
  `open-url`.
- Earlier boards: `MARK_VERSION`, `anyMark`, `Mark`'s `earlier`,
  `versionOn` (now `pinnedAt`), `isCurrent` in the navigator and the
  runtime, and their tests.
- `layout.ts`: `PALETTE` and `INK` (strings take `STRING_COLOURS`).
- The fake host's `update-drawdy-elements`, `set-selection`,
  `query-combined-rect` and `move`, which nothing calls.
- The request-32 panel: in `markup.ts` the old `PANEL_CSS` whole, `.row`,
  `#url`, `#open`, `h3`, `#try-box`, `#start-quota`, `#card-top`,
  `#card-links`, `.foot`, `#notice`; in `panel.ts` `NOTICE_MS`,
  `LOW_QUOTA`, `LONG_LABEL`, `renderNotice`, the quota lines, the `#open`
  handler, the paste check, the arrow span, the Next tooltip; in
  `protocol.ts` `quota`, `notice`, `ChipRow.arrow` (now `LinkKindRow`),
  `nextName` (now `hasNext`), `pr.label` (now `tag`); in `runtime.ts`
  `say`, `notice` and the "already on the board" line; in `navigator.ts`
  `nextName`; in `card.ts` the `arrow` of `LINK_WORDS` and `LinkGroup`,
  `CardModel.hides`, `PALETTES.red`; in `github.ts` `remaining`.
- Closing Read all on an empty board: the `scene:drawdy-element-selection`
  subscription, the navigator's `selection`, `selected` and `clearing`,
  and their tests and check line. A fold-row click clears the selection
  every time.
- The overview's fallback to the PR card and the first band:
  `VIEW.overviewMinZoom` and `overviewCamera`'s `firstBand`.
- The reading view's paste field and popover (request 39): in
  `markup.ts` `field()`, `LINK_ICON`, `#another-url`, `#another-error`,
  `#pop`, `.pop`, `.hint` and the grid rule that stacked the popover on
  the card; in `panel.ts` `showPop`, the focus and focusout handlers, the
  row hiding, the Esc branch for the popover and the second error slot;
  in `runtime.ts` the failed open's way back to the reading view.
- The `‹` `›` glyphs and the CSS dots of the loading steps (request 41),
  and the chalkboard artwork of the old icon; then the `presentation`
  artwork in `app-icon.ts` (request 43).
- mattpocock/skills#783's row, its `#1D9999`, and the tests and docs that
  name it (request 40).
- `panel.ts`: the PR card's "nothing when the description shows whole"
  branch; `LINK_WORDS`' `mentioned in` and `mentions` rows.
- The link rebuild (2.2): in `symbols.ts` `mentions`, `useEdges` (now
  `callEdges`, calls only) and the JS patterns' use for parsed files; in
  `model.ts` `LIMITS.mentions`, the mention block, the `addTests`
  callbacks, `importEdges`' JavaScript branch, `symbolBoard`'s and
  `fileBoard`'s name matching; `"mentions"` in `LinkKind`, `LINK_WORDS`
  (`mentioned in`, `mentions`), `FLOW_KINDS`, the mark guard in
  `elements.ts`, the label check in `check.ts`, the README and every test
  that names it; `MAX_SOURCES` and the source list in `open.ts` (now in
  `sources.ts`); the fixtures' `heads` (now `raw`). From A's code nothing
  that only served the research: `uncertain`, `candidates`,
  `membersNamed`, `maybe`, `guess`, `acceptGuesses`, `exists`, the
  importer scan, timings and memory figures.

## 11. Acceptance checks

T: a test. C: `scripts/check.ts` on hono#5513 (and the synthetic boards
where named). P: `npm run preview:board` screenshots. L: drawdy.io with
the dev server on a local board. G: the score gate, outside the repository
(2.2.9).

1. (C) hono opens in one `add-drawdy-elements` call: 10 components, one
   arrow and one label per drawn link (8 before the rebuild; up to 10
   after it, re-measured as 3.1 says), nothing else, no `groupId`. One undo removes it. No
   camera call comes before the add; one overview flight follows it.
2. (C) The 32-card synthetic board's add payload is under 512 KB. The
   bundle, built unminified as the marketplace builds it, is under 1 MB
   (about 238 KB), prints its size, and has no bare import but
   `@drawdy/driver-protocol`.
3. (T, C) Every arrow: both bindings, no `elbowRouting`, no `roughness`;
   `bend` of exactly 3 points, or for R1' 3 or more spaced evenly along
   its course (no step more than 1.6 times another). On hono every string
   has 3. Strings into one edge of a card share their end point; strings
   from one row or one card top share their start.
4. (T) hono, synthetic and excalidraw boards: no two cards or labels within
   8; no sampled string within 8 of a card or label but its own two cards;
   no sampled string goes past either end along its route's main axis by
   more than 2 (no hooks); each band's entry has the band's top, stacked
   48 apart, or 58 on a roomier board; a chain
   of seven calls stays within 400 of its band's top.
5. (T) hono: every link drawn; rects as in 3.1, the PR card, `fetch()`
   and `onError()` at x 0; the imports card centred under `toError()`.
   Synthetic: the `padCells()` → `formatRows()` cycle is drawn (R4).
   excalidraw: column gaps 240 at most; of the ten `uses` into
   `PointerDownState`, at most the nearest three drawn; of the links not
   into such a crowded card, at most 1 in 8 undrawn; every undrawn link
   is listed in the panel; 5 in 6 drawn strings labelled (28 of 33). R1'
   strings run flat along their lanes through a column. On every board
   no string runs closer than 24 to any of a card's four edges for 120 or
   more (excalidraw, elysia, bun and vite measured too: none does).
6. (T, P) excalidraw: the strings cross no more often than straight lines
   between the same ends (28 against 28); in the overview, light and dark,
   strings readable end to end, none behind a card.
7. (T) Labels: every hono label present, beside its string's middle bend,
   clear of all cards, labels and strings by 8; on every board each label
   sits beside a bend between two bends. After moving `compose()` 200 to
   the right in the test's points (`[start, end, ...bend]`, end moved),
   the spline still passes through each middle bend, so each label still
   clears and sits beside its string.
8. (T) Markdown: hono's description renders its headings, nested list,
   inline code and task list; the synthetic description renders every
   block of 5.5.1 and an alert with its bold word; no `<script>`, `on…=`
   attribute, `<img>`, `<iframe>` or raw tag from the input appears in any
   card or Read all page; comments are dropped; an image becomes
   `Image: alt`; a bare user-attachments URL becomes `Attachment`;
   `&amp;` shows as `&`; a nested `<details>` shows `▸` and its summary
   only on the card and opens in Read all; a 65 KB body is cut at 20 000
   before lexing. Titles render inline code; the panel gets them as
   segments. `:tada:` shows as 🎉 in titles and text, not in code; an
   unknown `:name:` stays.
9. (T, P) The estimate is at or above Chrome's measure for every preview
   description, by at most 10 % (9.2); a heading's margin collapses into
   the block above. hono's PR card shows whole blocks, ends on a
   paragraph, and has `⋯ Read all` right under that paragraph (P: no
   blank between them); a description up to 532 shows whole with no fold
   row; a first block too long for the card is cut inside with the 48
   fade, the only fade the card draws.
10. (T, C) Colours: every string takes one of `STRING_COLOURS`; all strings
    leaving one card share a colour, and each label its string's; on hono,
    the synthetic boards and excalidraw, no two strings from different
    cards that cross share a colour; a dashed string is the unchanged
    caller's, and only it. P: excalidraw's overview, light and dark, shows
    crossing strings apart; hono stays calm (two colours).
11. (T) Without the panel ever opened: after `start()`, a fold-row click
    is found from the mark's `folds`, and a label click follows its string
    and flies the camera; none of them reads a stored review or makes a
    GitHub request until Read all actually opens. Then it loads the stored
    review, else GitHub, showing `Reading the pull request…` first; a
    click on another card meanwhile leaves no popover open, whether the
    review loads or fails. A
    click on an element that isn't PR Blackboard's makes one read and nothing more.
    `camera:moved-rapid` is subscribed only while a popover is open.
12. (T, C) Nine steps in the order of 4.1, never `fetch()`; no step adds,
    updates or creates anything on the board, nor a floating element.
    Next, Previous, a follow and the overview clear Drawdy's selection
    before the camera flies; a fold-row click clears it; any other click
    on a card does not clear it.
13. (T) `hasPrevious`/`hasNext` and the panel's disabled buttons; picking
    up a pinned board leaves the PR card current, with no flight; when
    the review can't be had (GitHub limiting, no stored copy), the start
    view shows why under the field.
13.1 (T, C) Every card that hides code ends in `Read all` and the panel
    offers it: hono's `toError()` (`⋯ 1 line cut short · Read all`, opening
    at line 5), `compose.test.ts` and `hono.test.ts`; a card that shows
    every line whole has no such row. The PR card is the exception: the
    panel offers `Read all` under `Description` whenever there is a
    description, folded or not (excalidraw#12237's whole one included),
    and `No description provided.` with no button when there is none.
14. (T, L) Camera: every hono step at 1920 × 1080 and 1280 × 800 keeps zoom in
    0.8 to 1 and the card whole (or its top). No hono or excalidraw step
    leaves its card under the minimap's 196 × 168 corner, nor a tall card
    pulled toward names up and to the right; live, excalidraw's
    `handleCanvasPointerMove()` step shows its gutter clear of the
    minimap. The overview frames the whole board, centred.
15. (T) Card beats label beats string; a click over 10 / zoom from a
    string's sampled curve does nothing; a click on another card closes
    the popover.
16. (T, C, P, L) Read all's left edge is at least the card's right + 24 at
    both sizes; it opens with the card's header and `✕` only; `✕` and
    `Esc` close it; it takes the cards' theme. On the PR card it shows the
    whole description. It is as tall as its page: on `toError()` under
    200 (128), on `compose()` the full 640 with the page scrolling.
17. (T) The panel, as 7.2 and 7.3 lay it out: the start view is the field
    (no button), the error slot and the 13 example rows in 7.2.3's order,
    with 7.2.5's colours, oven-sh/bun#30412's tag line ending `23 of 60
    GitHub requests` and no other row carrying a cost, no
    heading and no `Try` anywhere, each a button with its project-coloured
    tag on its own line then its title, the list alone scrolling; a paste
    or Enter posts `open` with whatever was typed; a failure shows in the
    slot by the field, keeps the link, and goes on typing. Loading shows
    the tag. The reading header has the plain tag in its project's colour
    and `+202 −11` in the cards' green and red, wrapping, never cut; the
    current card's chip follows its name, its path is plain text with break
    points, `Read all` only when the card hides something (5.1.1); the
    PR card shows no name, path or links, only the muted word
    `Description` and `Read all` (13.1), so the card area is never empty;
    links by kind, never `mentioned in` or `mentions`, a context link as
    `called by` or `used by` by its references; counts with grouped digits
    (`+1,009,257 −4,024`);
    nothing in the panel has `↗`; no `Start with` line. The reading view
    ends in `Open another`, which posts `start`; the start view then has
    the field focused, and there is no field, popover or error in the
    reading view. After `start` the board stays, and a click on one of its
    cards brings the reading view back. Previous, Next and the loading
    marks are Lucide SVGs, with no `‹` or `›` glyph. The protocol accepts
    only the messages in 7.3.5. No context menu is registered.
18. (T) Opening a pull request already on the board at its head commit
    flies to it and adds nothing; a mark of any other shape is not read.
19. (P) Overview, light and dark, for hono, synthetic and excalidraw: no
    title, lane labels or rings, no lime on the board; strings hang in a
    curve you can see and bend through lanes, no hooks at either end; PR cards
    render Markdown like GitHub; code colours match 5.4. Panel states
    match 7.2 and 7.3, including the PR card current with a description
    that shows whole, the first-run loading view with the download step,
    and both parser errors. Each of the 13 examples' boards, rendered from
    a saved copy (9.1), reads well and draws strings; oven-sh/bun#30412's
    shows its Rust.
20. (L) At 1920 × 1080, on a dark board in a light browser: the board
    arrives in one add call, cards dark; the PR card shows hono's
    description as Markdown; strings and labels look as in the preview, in
    their colours, with no hooks. After a reload, with the panel never
    reopened, a label click follows its string and a fold row opens Read
    all. After Next, no card keeps Drawdy's selection. No console errors
    from PR Blackboard.
21. (L) At 1280 × 800, Read all on `#dispatch()` opens right of the card,
    clear of the panel.
22. (L) In Drawdy's dark and light themes: the start view's 13 example
    rows (the list alone scrolling, the field in place), the GitHub-only
    error, an example opened from its row, the reading view with its
    Lucide chevrons, `Open another` back to the start view with the field
    focused and the board kept, a click on a card bringing the reading view
    back, and Read all's Lucide `x`; with the PR card current, the
    `Description` row under the nav.
23. `npm run typecheck`, `npm test`, `npm run check` pass.
24. (T) Link finding as 2.2.8 lists.
25. (G) The score gate (2.2.9), `node SCRATCH/research/gate/run.ts`,
    prints one row per pull request: cards, links, wrong (pair, kind),
    truth links, found, recall, A's floor, and against A's own links the
    pairs added and lost; then GitHub API requests (2 each), raw requests
    and 404s, jsDelivr requests cold and warm (0), bytes read and time.
    Then the kinds pooled, every wrong link with its evidence lines, every
    missed truth link with its evidence and source (TypeScript or hand),
    every card the truth can't anchor, and any request to a host other
    than `api.github.com`, `raw.githubusercontent.com` and
    `cdn.jsdelivr.net`. It ends `GATE PASS` or `GATE FAIL` with the
    reasons, and exits non-zero on a failure.
26. (T, L) The parser as the reader sees it. T: with nothing stored, the
    loading view shows `Downloading the TypeScript parser · first time
    only` between the first and the reading step, and both can turn at
    once; with the files stored, it never shows; a JavaScript-only pull
    request names the `JavaScript parser`. A failed download and a wrong
    hash each end in the start view with `Couldn't download the
    TypeScript parser from cdn.jsdelivr.net. Try again.`, the link kept,
    nothing pinned and nothing stored; a parser that won't run ends with
    `Couldn't parse this pull request's TypeScript.`; a retry in the same
    session makes no GitHub request. One file the parser can't read is
    no error. L: on a new local board with the parser not yet stored, the
    first JS or TS example opened shows the download step once; a second
    open of a TypeScript pull request does not; no console errors.
27. (T, P) Fewer strings, said nowhere: no board element, panel row or
    README line counts or mentions links left out; the panel lists exactly
    the review's links. hono's ten links, among them the dashed `tests`
    string from `hono.test.ts` into `fetch()`, which stays in the bottom
    row (P: the overview still calm, light and dark).

