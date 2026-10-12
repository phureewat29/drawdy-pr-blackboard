# PR Blackboard: developer guide

How PR Blackboard works, how to run it locally, and how to publish it. For what
it does and how to use it, see the [README](../README.md). For the board's
spec and the checks it is built against, see [flow-spec.md](flow-spec.md);
for the earlier research, [design.md](design.md).

## How it works

```
drawdy.io
├── extension host: sandboxed iframe → blob: worker
│     PR Blackboard driver (src/index.ts, src/driver/)
│     fetches the PR, pins its board, follows the reader
│     └── parser worker: a blob: worker of the driver's own (src/worker/)
│           reads the PR's files, parses and links them, builds the
│           review and plans its board
│                 ▲ messages, checked at runtime (src/shared/protocol.ts)
│                 ▼
├── PR Blackboard panel: webview (src/webview/)
│     link field, loading checklist, the current card and its links
└── on the board: cards (iframe components), strings (curved arrows bound
      to two cards) and their one-word labels
```

Opening a pull request runs one pipeline, each stage a pure function in
`src/lib/`. The driver runs the first stage and the last; the parser
worker runs the rest (see below).

1. **Fetch** (`github.ts`): the pull request and its file list from
   `api.github.com`, four pages in flight at a time. A PR's `.diff` URL
   sends no CORS headers, so the diff comes from the files endpoint.
2. **Read the code** (`sources.ts`): from `raw.githubusercontent.com` at
   the head commit, which costs no API quota, up to 16 requests in flight,
   each path once, each text taken in the same order however the requests
   come back. The changed code files and the tests the parser reads
   (up to 40 of each, under 400,000 characters; past 40, `pickFiles` takes
   the largest changes in the pull request's main languages, spread across
   its top folders; code the parser doesn't read only with its patch, but
   a file added whole, whose every line is new, also without one); the
   `tsconfig.json` or `jsconfig.json` nearest each
   changed JavaScript or TypeScript file, its relative `extends` followed,
   for `paths`; the typings a config names; and each changed file's direct
   imports, trying TypeScript's candidates in order (`./client` is
   `client.ts`, …, `client/index.ts`) until one answers. Nothing past the
   direct imports, and no search for importers. For Python, each changed
   file's imports by module (`a/b.py`, then `a/b/__init__.py`), and one
   hop more where a module read imports the name from another; for Go, the
   `go.mod` nearest each changed file; for Rust nothing more, and no test
   in a file of its own. Every changed file read is parsed, however much
   there is.
3. **Parse** (`syntax.ts`, `facts.ts`, `anyfacts.ts`): tree-sitter
   (web-tree-sitter 0.27.1, vendored in `src/vendor/web-tree-sitter.ts`)
   with the TypeScript, TSX, JavaScript, Python, Go and Rust grammars. The
   driver's `grammars.ts` downloads them from jsDelivr at pinned versions,
   checks each against a SHA-256 written in `PINS` (`sha256.ts`; the
   worker has no `crypto.subtle`), and keeps them in kv-storage as
   `{ sha256, blob }` under `wasm:runtime` and `wasm:` and the grammar's
   name; the parser worker asks the driver for each. A pull request loads
   only the grammars its files need, beside the raw reads, and none
   without a language the parser reads. The tree is flattened into typed
   arrays, then `facts.ts` reads each JavaScript or TypeScript file's units
   (the declarations a card can stand for), scopes and bindings, sites
   (every name that refers to something), imports, exports and the
   members of its classes and objects. Python, Go and Rust go to
   `anyfacts.ts`, which takes its units from the definitions in the
   grammar's own `tags.scm` (`tags.ts`), and the rest as the language's
   rule table in `langs/` says.
   A file with a `@flow` pragma, or with more than 2 % of its text in ERROR
   and MISSING nodes, isn't trusted to the parser: React's Flow files
   measure 3.2 % and 100 %, the scored pull requests at most 0.6 %.
4. **Resolve** (`linker.ts`): every site in the changed files and the
   files that import one, to the declarations it names: through block,
   function, class and module scopes; imports, re-exports, `export *` and
   CommonJS; and members whose receiver is known (`this`, `super`, a class,
   a module, an object literal, `new C()`, a typed local, a prototype). An
   untyped parameter, a call's result, a global or a package resolves to
   nothing, and makes no link. The one guess is `builtinRule`: in
   nodejs/node and oven-sh/bun, a Node built-in import means the
   repository's own file when the pull request changes it. Python, Go
   and Rust resolve in `anylink.ts`, the same for each but for its rule
   table: through scopes, imports, a Go package's files and its `go.mod`
   module path, Python's C3 method order and `super()`, and the members
   of a receiver whose type is written, built or a class's own. A name
   makes a link only when exactly one declaration is proven; an interface
   or trait call, an untyped parameter, a name bound twice in one scope
   and a Rust path into another file make none. Neither does a
   declaration's own name, a type parameter, a name a Rust macro binds,
   a standard-library module, a Python module two roots hold or one may,
   an import that may run after its file changes `sys.path`, a Go file
   another build holds, or an inherent Rust method a trait method of an
   earlier step of the method probe may come before (spec 2.2.10).
5. **Build the review** (`model.ts`): pins and links. In a parsed file a
   changed line belongs to the innermost unit whose range, from its first
   comment to its last line, holds it; other files keep the line patterns
   of `symbols.ts`. A method's card is named with its type in Python, Go
   and Rust (`Store.delete()`, `Server.Start()`, `Request::new()`; a
   Python property without `()`, `Dependant.is_gen_callable`; on the
   card, a name too long for its header loses its type from the left,
   never the method, `headerName` in `card.ts`), and a
   Go or Rust method counts as nested in its type, as a Python method in
   its class, so no string runs from a method to its own type, and a
   class card folds the lines of the cards nested in it. Changed
   declarations joined by references form threads
   (`graph.ts` gives each a column, callers left, cycles broken). Each
   thread gets at most one context card: the first unchanged function in
   the files read whose code references its entry, and isn't
   `@deprecated`. Then every resolved reference makes a link from the
   innermost card holding it to the card standing for what it names: from
   a test card `tests`, from the context card `context` (reading `calls` or
   `uses` by its references), then `calls` for any call, `uses` for any
   other reference, `imports` for imports alone. A file no parser reads
   draws no string: nothing links by name. A test hangs under the first
   thread it covers, and a file card whose
   links all go into one thread hangs under it (lane `under`), so their
   strings run up: hono's imports card hangs under `compose()` and
   `toError()`. A board holds 32 cards, the PR card included: `limit` keeps
   them in fill order (each thread whole with its context card and tests,
   largest first; of a thread that doesn't fit, its cards nearest the
   entry, or a part grown along its links or its calls alone, whichever
   keeps more calls between its cards, then more links; then the bottom
   row, the largest changes first), and `unpinned` counts the functions
   and files left off for the PR card.
   Calls outrank type uses there: on Bun's Rust, uses of a file's types
   join all its declarations into one thread.
6. **Plan the board** (`layout.ts`, with card grids from `card.ts`): the
   PR card alone in the first column at (0, 0), as tall as its whole
   description, and the code laid out without it, 160 to its right, so a
   long description never pushes a card down; bands top to bottom, one
   per thread, with the row under it (its tests and hung file cards);
   columns left to right, 160 apart, every card after column 0 as wide as
   its column, column 0 on the code's left edge.
   Cards in a column stack in the order that keeps strings short and
   parallel: by the rows that call them, then four sweeps by where all
   their links pull them, keeping the order whose strings cross least as
   straight lines. Entries take the band's top, so the first one is level
   with the PR card, and so does a context card; every other card's header is level with a row that
   calls it within 400 of the band's top, else it starts at the top and
   its string slopes. A card in the row under a band tries spots under the
   mean of the cards it links to, then under each of them, and takes the
   first from which a string clears. Then the strings, once every card is
   placed, shortest first: each is an arrow through bend points, which
   Drawdy draws as a uniform Catmull-Rom spline through `[start, ...bend,
   end]` (`curve.ts` holds a copy of the host's `catmullRomSpline`). R1 is
   straight with a sag of 8 % of its length, 20 to 48, like string pinned
   at both ends (smoothstep, climbing mid-gap, when it must clear a card's
   corner or would run along a card's side); R1' runs flat along a lane
   through a gap in each column in its way, at least 24 from the cards on
   both sides, with a bend every 64 or so; R2 goes up or down,
   R3 flat in the bottom row, R4 back over both cards. A route counts when
   its curve clears every other card by 8, hooks at neither end, and runs
   closer than 24 to none of a card's four edges for 120 or more; of
   those, the one crossing the fewest strings drawn so far wins. A link
   gets its string only while the strings, all told, cross no more often
   than straight lines between the same ends would, and only the nearest
   three of a kind go into one card. From the row under, a string rises
   only to a card above its own card, the two overlapping in x, but a card
   there that would have no string at all keeps its shortest sideways link
   that routes, tried after every other link. When some
   link is left over on the compact board, it is planned again roomier
   (`LAYOUT.roomier`): 240
   between columns, then also 58 between stacked cards, room for a second
   lane; the plan drawing more strings, then crossing less, wins. Labels go last, beside a bend between
   two bends. The panel lists every link, drawn or not. `buildReview`
   returns the review with this plan, and keeps its board order as
   `review.order` (`stepsOf` in `layout.ts` leaves out the PR card and
   context cards: the steps walk the code), so
   the board and the steps share one order, the board is planned once,
   and the navigator never plans again.
7. **Pin it** (`driver/open.ts`, `driver/elements.ts`): in free space near
   the camera (`driver/space.ts`), in one `add-drawdy-elements` call: the
   cards, then each string with its label, nothing grouped. That is one
   undo step. Only then does the camera move, once, to the overview.

**The parser worker** (`src/worker/`, `driver/parser.ts`). Stages 2 to 6
run off Drawdy's driver worker, which every extension shares: a big pull
request would otherwise stall them all, and the panel's own loading
steps, for as long as it takes to read (oven-sh/bun#30412: 2.6 s at a
stretch before request 57; 74 ms now). Drawdy's driver worker is a `blob:` worker of
origin `null`; a worker it starts from a `blob:` URL runs WebAssembly and
reads raw.githubusercontent.com, as the live probe showed on drawdy.io,
and nothing on the bootstrap page sets a CSP. The marketplace bundles
`src/index.ts` alone and allows no import but `@drawdy/driver-protocol`,
so the worker's code reaches the driver as text: `npm run worker` bundles
`src/worker/main.ts` (which serves `serve.ts`) with esbuild into
`src/worker/script.ts`, `WORKER_SCRIPT`, and a test and `npm run check`
fail while it is behind its sources. The driver never imports the parser
or the linker itself, so they are in the bundle once, inside that
script. The dev server runs `npm run worker` on every change under
`src/` (`vite.config.ts`), so what it serves is never behind; elsewhere,
run it after changing anything under `src/lib/` or `src/vendor/` the
worker uses.

`driver/parser.ts` starts the worker from the script as a `blob:` URL
and sends it the pull request and its file list (Bun's 44 MB of patches
in about 40 ms). The worker reads the raw files itself and asks the
driver for each parser file, which `grammars.ts` loads and checks; the
driver reports the download as a loading step. It sends back the review
the driver keeps, `compact` (no diff of a file without a card: 3 MB for
Bun's, 84 MB whole, half a second to copy), and the board's plan, so the
driver plans nothing. Where no worker can start, or one breaks, the same
script runs on the driver's thread, its messages copied as a worker's
are: the boards are the same, and so is what Node runs, which has no
`Worker` (the tests and `npm run check`). A worker idle for 30 s ends,
since Drawdy tells a driver nothing when it unloads. The tests and the
score gate serve `serve.ts` from source on their own thread
(`connectSource` in `src/test/parser.ts`).

**Rebuild** (request 48; the toolbar's second button). A
`rebuild` message reads the pull request being read from GitHub again,
past this device's copy and the last read (`loadReview`'s `fresh`), and
parses and plans it anew. The new board goes where the old PR card
stands, then the old board's elements go, found by their marks (this
pull request at the board's head commit) just before the add, so the
reader's own notes and strokes stay. DDP 1.3 snapshots history before
every scene command, so that is two undo steps, the add and then the
removal; two undos bring the old board back. Any failure leaves the old
board as it was and puts the error in the reading view's `error`, which
the panel shows on the toolbar's line. The view carries `rebuildCost` when
reading GitHub again costs more than 2 requests, and `rebuilding`, the
step under way. The panel holds Rebuild down on a first press that would
cost more than 2 and says the cost on the toolbar's line; the second
press sends `rebuild`, and Esc or any other control lets it go: holding is
the panel's own state, so the driver never hears of it. The press that
sends `rebuild` turns Rebuild off at once. A removal the rebuild
made is not the reader's (`swept` in the runtime), so the board stays
picked up even when Drawdy reports it before the command answers.
`rebuilding` holds the one rebuild that may run, from the message on:
another `rebuild` is refused. It runs outside the opens' queue, with its
own steps, so an open of another pull request starts at once; an open
of the board being rebuilt waits for it. When it ends it focuses the PR
card and flies to the overview only if the panel is still in the reading
view of that board; otherwise the navigator, if it holds the old board,
moves to the new one silently, and a failure reads `honojs/hono#5513 ·
failed: …` on the line the reader sees. An error clears at the reader's
next action, a click on the board included. A reload between the add and
the removal leaves two boards of one pull request: the pickup reads the
newest, last in Drawdy's scene order (`indexOf` lets a later card win),
and the next Rebuild removes both at one commit.

Every element carries a mark in its `meta` (`driver/elements.ts`): the PR,
the head commit and what the element is (`pr`, `pin`, `link`, `label`). A
card's mark also holds its pin id, its name, its size when made and its
fold rows as `[top, line]` (the PR card has none: it shows its whole
description); the PR card's also the theme its cards were pinned in. A
string's mark holds its link id, kind, both pin ids and its colour's index
in `STRING_COLOURS`, so the panel names each link in its string's colour
from the board alone. So the board works from its marks alone, after a
reload or on a teammate's screen. One strict reader takes these marks and nothing else: PR
Blackboard hasn't shipped, so no earlier shape is read. Reviews kept on
the device carry their own version (`REVIEW_VERSION = 10` in
`driver/store.ts`); a copy of another version is fetched again. A stored
review keeps a file's diff only when it has a card (`compact` in
`model.ts`), as the parser worker sends it.

**Colours.** A string's colour tells it apart; its label says what it
means. `colourStrings` in `layout.ts` gives every string leaving one card
that card's colour, from eight hues (`STRING_COLOURS`, Okabe-Ito's,
darkened where they were too light for Drawdy's light canvas; Drawdy draws
hex colours as given in both themes). Cards whose strings cross, meet at
one end or run within 12 of each other for 60 or more get different hues:
greedy, the most conflicted card first, then board order, so a pull
request always gets the same colours. A label takes its string's colour.
The panel names each link in its string's colour (request 50), as
`STRING_TEXT` beside `STRING_COLOURS` gives it for 12 px text on the
panel's background, white or `#27272a`: the string's own colour where it
reaches 4.6:1, else the nearest OKLCH lightness that does, its hue kept,
and no two closer than the board's two closest strings. `themeCss` writes
them as `--string-0` to `--string-7`.

**The PR card** (`card.ts`, `markdown.ts`) shows the description as
GitHub-flavoured Markdown with GitHub's styles. `marked` 18.0.9 is vendored
unchanged in `src/vendor/marked.ts` (MIT, its licence header kept, `//
@ts-nocheck`), because the marketplace builds without `node_modules` and
allows only `@drawdy/driver-protocol` as a bare import. `markdown.ts` uses
only its `Lexer` and renders the tokens itself, so every tag on the page is
one it chose and all text is escaped: raw HTML is dropped but for `<br>`,
images become an `Image: alt` chip (nothing is fetched), a bare
`user-attachments` link becomes `Attachment`, links are inert, and a
`<details>` shows open on the card, its summary a bold line, and opens
for real in the panel. Code fences use the cards' own highlighter, and
`:tada:` and other common shortcodes show as emoji (`emojify`), in titles
too. The card shows the whole description, however long (request 55);
the layout gives the PR card a column of its own. A card's height is
fixed when it is made, so `markdownBlocks` estimates each block from
GitHub's metrics, collapsing margins as Chrome does, 2 to 8 % above
Chrome's measure (the preview prints both), and the card's height holds
the whole estimate. The whole description is lexed: GitHub keeps one to
65,536 characters. `lexMarkdown` runs `marked`'s block pass, then lexes
each inline run (a paragraph's, a list item's, a cell's or a heading's
text) only when it has 200 or fewer of `*`, `_` and `~`, or is 2,000
characters or shorter and the description hasn't spent its budget on
such dense runs (eight of 2,000 characters); any other run shows as
typed. `marked`'s emphasis scan grows with the square of a run's `*_~`;
backticks and brackets cost little (64 KB of them, 23 ms at most), so
they don't count. A crafted 64 KB paragraph took 12 s and now takes
4 ms, the worst shape left about 0.14 s, and every saved description
renders byte for byte as before. An alert's lead, its first paragraph
after `[!NOTE]`, comes from that paragraph's own tokens at lexing, so
rendering lexes nothing. It remembers the last 4 descriptions by their text, so the
layout, the board and the panel lex each once on a thread. One `marked`
can't lex shows as plain text. The panel shows the same description,
rendered once per review by the driver in page mode. Diff, syntax and Markdown colours are GitHub's
Primer ones.

**Clicks on the board.** A component is an iframe that can't report where
it was clicked. Clicks reach the driver as `scene:click` in canvas
coordinates, listing every element whose box holds the point. PR Blackboard
subscribes in `start()`, when Drawdy starts it, so the board works with the
panel closed, after a reload, or for a teammate. A click costs one read:
`get-drawdy-elements` for the clicked ids, with their marks, rects and
points; none of them PR Blackboard's, and it stops there. The navigator picks
card, then label, then string. On a card, the live rect and the mark's size
give the card-local height: a fold row (from the mark's `folds`) or the
card itself. A string counts only
within 10 screen pixels of its curve, sampled from its live points
(`[start, end, ...bend]`). Only a string or label click reads the board's
marks, once, into the navigator's index; Read all alone needs the review,
and loads it then (the stored copy, else 2 GitHub requests), saying
`Reading the PR…` meanwhile. A click never moves the camera; a
click on a card other than the current one closes the popover.

**Themes.** A component's iframe takes `prefers-color-scheme` from the
browser, not from Drawdy: Chrome ignores the `color-scheme` Drawdy sets on
its page. Drawdy's board is dark by default and the browser is often
light, so cards that followed the media query landed white on a dark
board. Each card now fixes its colours (`PALETTES` in `lib/card.ts`) to
the theme Drawdy reports when it is pinned, and the PR card's mark keeps
that theme. Read all reads it from there, so the overlay always matches
the cards, whatever Drawdy shows now.

**Labels and drags.** Nothing on the board is grouped: a group made a card
click select its labels too, and Drawdy then opened its text inspector.
PR Blackboard moves nothing after a drag. Drawdy moves only a string's bound
ends and keeps its bend points; the curve's direction at a bend between
two bends depends on those two alone, so the string still passes through
the bend its label sits by at the same angle and the label stays beside
it. DDP 1.3 can't move an arrow's bends (`update-drawdy-elements` sets
style, meta and position only), so a long drag kinks a string near its
card; `hono-dragged.png` in the previews shows it.

**Read all** (`driver/read-all.ts`), the one popover, is a pane on the
board, right of its card (requests 51 and 52). Its place is a rect in
canvas units (`readAllRect` in `lib/view.ts`): 24 right of the card, top
level with it, 720 wide, as tall as its page up to 640 (`readAllOf`
returns the page with a `height(width)` estimate from its rows and
wrapped lines), so a two-line function gets a short pane. Drawdy's
floating elements sit in screen space, at z 70 over its own chrome, and
its popover kind keeps the position it opened at, so PR Blackboard uses
the overlay kind: a box the size of the usable view, which clips the pane
so it slides under Drawdy's toolbar and the panel as the cards do, and
lets the pointer through (`pointerEvents: "none"`), holding the pane
(`"auto"`), laid out at its canvas size and placed by a CSS transform:
its top-left where canvas-to-screen puts the rect's corner, scaled by the
zoom (`readAllFrame`; CSS scales about a box's middle, which the
translation makes up for). On open it reads `camera:get-info` and one
`canvas-to-screen` to learn where the canvas sits, then places the pane
again from each `camera:moved-rapid` body without asking (an
`update-floating-element` with the new transform: Drawdy keeps the same
element and iframe, so the page keeps its scroll), one placement at a
time and then one more with the latest camera. It subscribes to
`camera:moved-rapid` and `dom:screen-resized` when it opens and removes
both when it closes. It opens readable: when the zoom is outside 0.8 to 1,
or the card's right 240 and the pane don't fit the usable view, the
camera first flies to show them (`readAllCamera`). Opens, replacements
and closes run one at a time; a new page for the card shown (the review
loaded) keeps the pane where it is. The pane holds one iframe, whose page
opens with the card's own header, sticky, then the code rows, unified and
wrapped, a wrapped line continuing under its own indent. Over the header,
in a row of no height before the iframe, their transforms drawing them
above it: the drag handle, a box with its own id, since Drawdy reports
drags by an element's id (`dom:drag`), and `✕`, a schema button, since
only those report clicks (`dom:element-clicked`). A drag moves the pane's
rect on the board with the pointer, its header kept where it can be
grabbed again (`dragLimit`). The page's only script scrolls to the folded
lines or the first change, a third of the way down, snapped so a whole
row starts under the header. Drawdy lays the pane out after the page
starts, which resets the scroll, so the script scrolls again on each
resize for two seconds or until the reader scrolls. It sets its own
scroller's `scrollTop`: `scrollIntoView` would also scroll the pages
around the iframe. Read all closes on `✕`, on Esc while the board or the
panel has focus, on a click on another card, and on Next, Previous, a
follow, Description, the overview, Home or Rebuild. A click on empty
board leaves it open: Drawdy sends no event for it. Next, Previous, a
follow, Description and the overview also clear Drawdy's selection
before the camera flies, so no card stays selected away from where the
reader is, and Drawdy's toolbar for it never covers the card flown to. A
fold-row click clears it too, then opens Read all.

**The camera** (`lib/view.ts`). The usable view is the screen less Drawdy's
toolbar (64) and the panel's strip (392: Drawdy's 58 px button rail, the
320 px panel and a margin, as measured on drawdy.io). Code is 12.5 px, so
the camera never goes below zoom 0.8. `stepCamera` has two rules: frame the
card and the cards its drawn strings join when they fit at 0.8 or closer;
otherwise frame the card alone at the largest zoom from 0.8 to 1 that
leaves 160 of room each side, the room shrinking toward 0 when the card
needs it. In the second rule the frame then moves, as little as it can,
to take in the names of the joined cards (`nameRect` in `card.ts`),
nearest first, while the card stays whole at 0.8 or closer; a name that
can't fit still draws the frame its way until the card's far edge meets
the margin. Last, Drawdy's minimap covers the bottom-left corner
(`VIEW.minimap`, 196 × 168 with its margin), so when it would cover the
card the frame moves back the least it takes, the card going right or up
and staying whole. The rect passed to `fly-to-rect` has the screen's shape,
so it lands on exactly that zoom. When the card already shows whole at 0.8
or more, clear of the minimap, the camera stays still. Description frames
the PR card the same way. The navigator reads live rects, so moved cards
count. The overview frames the code cards whole and the PR card down to
the lowest code card (`overviewBounds`), centred, so a very long
description runs on below the frame instead of shrinking the board; it
unions each card's `element-rects` itself: Drawdy's `query-combined-rect`
takes only the top-left corner of every component after the first.

**No highlighter.** Stepping, following a link, a click or a drag changes
nothing on the board: the camera and the panel show where the reader is,
and every string keeps its own colour and width. So PR Blackboard draws no
preview elements and does not subscribe to `scene:elements-updated`.

**The panel** (`webview/`) follows the request-32 design and the toolbar
design of requests 47 to 55 in [flow-spec.md](flow-spec.md) 7.2 and 7.3:
`PANEL_CSS` in `markup.ts` is the design's stylesheet, followed in the
same sheet by the cards' `MARKDOWN_CSS` and `PANEL_MD_CSS`, which fits it
to the panel, and every colour comes from Drawdy's theme vars, which load
first. One paste field, with no button and no `<form>` (Drawdy's webview
sandbox has no `allow-forms`): a paste opens at once and so does Enter;
only the driver's `parsePrUrl` decides what is a GitHub pull request, and
answers anything else with `Only GitHub PR links work, like
github.com/owner/repo/pull/123.` The reader sees "PR", never "pull
request" (request 60). A link that isn't a PR says so under the field,
the link kept; an open that fails on the way stays on the loading view at
its failed step; an action's error in the reading view shows on the
toolbar's line.
The start view lists the 15 examples under the field, no heading, each
its tag in its project's colour (`SUGGESTIONS` ships label, title, colour
and changed-file count; `projectColour` colours any pull request of those
repositories), then its title; a row that costs more than the usual 2
GitHub requests says so after its tag (`23 of 60 GitHub requests`, only
Bun's rewrite). Loading shows the tag, then the steps as a CI job lists
them (`driver/progress.ts`): a mark per state, a count while a step runs
or the time it took, a row per parser downloading and per changed file
read (10 at most, then `and N more`), and the warnings found so far as CI
annotations (`driver/warnings.ts`); a failed open stays there, at its
failed step, with Home and Try again. The reading
view is three rows: the header (tag, `+additions −deletions`, state,
title); the card area, which scrolls: at a code card its name and chip,
`Read all` only when the card hides code, its plain path and its links by
kind, each name in its string's colour (`style="color:
var(--string-N)"`, the index from the string's mark); at the PR card,
where every board lands, who opened it and how big it is, then the whole
description, which the driver renders once per review; and the toolbar:
Home, Rebuild, a rule, Overview, Description, Previous, the position and
Next, Lucide icons with `data-tip` tooltips and accessible names, the
line above them for a rebuild's step, its cost or an error.
`hasPrevious` and `hasNext` are all Previous and Next need; Description
carries `aria-current` while the PR card is current. Home sends `start`:
the start view comes back with the field focused, the board stays, and a
click on any of its cards brings the reading view back (`boardClick` in
the runtime). Every icon is Lucide 1.53.0 (ISC), inlined from
`shared/icons.ts`; the loading marks sit in `<template>`s in the markup,
since the serialized panel script draws no SVG itself, and Read all's
close button is an image of Lucide `x`, as a schema has no SVG node.
`themeCss` (`driver/channel.ts`) gives the panel, for Drawdy's theme, the
cards' `--add`, `--del`, `--add-gut` and `--blue`, the colours the
description needs (`--md-*`, `--add-bg`, `--del-bg` and the syntax
colours) and the strings' `--string-0` to `--string-7`. PR Blackboard
keeps no list of opened pull requests, only each stored review.

## Test locally

1. `npm install`, then `npm run dev`.
2. Open a **local** board on drawdy.io (development links are disabled on
   cloud boards), press `⌘K`, run **Add extension dev server**, and enter
   `localhost:5173`.
3. Click the PR Blackboard button on the right edge, allow the permissions, and
   open `github.com/honojs/hono/pull/5513`.

Drawdy reloads the extension on every save, which removes its panel. Click the
button to open the new version. Removing the dev server forgets its
permission answers.

## Development

```bash
npm test             # Jest: the pure core, the navigator and the panel (its width test runs in Google Chrome, if installed)
npm run typecheck
npm run build        # dist/a-pr-blackboard.drawdyx
npm run check        # reproduce the marketplace build and smoke-test it
npm run preview      # serve the marketplace build to Drawdy on :5174
npm run preview:board  # render the board and screenshot it (needs Google Chrome)
npm run worker       # bundle the parser worker into src/worker/script.ts
npm run icon -- <listing.png> <64px.png>  # wire in the extension's icon
```

`npm run check` builds with esbuild as the marketplace does, unminified,
and reports that size. It fails on any import but `@drawdy/driver-protocol`,
on a bundle of 1 MB or more, on a parser worker script behind its sources,
and on the parser or the linker reaching the bundle outside that script;
it checks the listing icon is a 512 px PNG and the button draws its 64 px
copy. Then it boots the bundle in a fake Drawdy
host (`src/test/fake-host.ts`), whose kv-storage keeps what it is given,
and runs the panel in jsdom. It opens honojs/hono#5513 from the saved
fixture through one fake fetch (`src/test/fake-fetch.ts`: GitHub's two
answers, the fixture's `raw` files, the pinned wasm from `node_modules`)
and checks the board against the spec: the runtime and the TypeScript
grammar downloaded once and kept, one add call holding 10 cards, 9
strings curving through three bends and 8 one-word labels, and nothing
else, the PR card 640 × 779 with no fold row and the code 160 right of
it, strings into one edge sharing their tip, strings in the palette's
colours, one per card they leave, each label its string's, the strings
into and out of `fetch()` dashed, nothing grouped, cards in the theme
Drawdy shows, no camera move before the add and one flight after, the
board landing with the PR card current and its description in the
panel, `– / 8`, eight steps of code without a popover or any change to
the board, each clearing Drawdy's selection, the link names in their
strings' colours, Description flying to the PR card, Read all on the
board 24 right of its card, 720 wide and scaled with the zoom at both
sizes, moving with the camera, with its handle and `✕`, and Home back to
the start view with the board kept, a card click bringing the reading
view back. Then it boots
the bundle again, as after a reload, and with the panel never opened
follows a label and opens Read all from a fold row, clearing the card's
selection, with no request to jsDelivr. Before the reload it rebuilds the
board: 2 GitHub requests and no download, the add and then the removal
of the old board's elements, the new PR card where the old one was moved
to, and a note of the reader's kept. Node has no `Worker`, so the parser
worker's script runs on the driver's thread throughout. Last, a 32-card
board's add payload stays under 512 KB.

`npm run preview:board` renders hono, excalidraw#12237 and made-up boards
(`src/test/synthetic.ts`: two threads with a description holding every
Markdown block, and one at the 32-card limit) from the real plan and
element schemas: cards as their own HTML in iframes, strings drawn exactly
as Drawdy draws them, each board pinned in light and in dark, the board as
it lands, close-ups through the step camera, the PR cards as Description
shows them, a PR card five times hono's, Read all on the board (beside
its card, zoomed out with it, dragged), a dragged card and the panel's
states. It prints each board's links drawn and not, its string crossings
against straight strings, its colours and how many crossing strings
share one, and each description's height as Chrome lays it out, whole,
beside the estimate. It writes HTML and 2× PNG
screenshots to `dist/preview`, or to the folder given; a screenshot
counts once Chrome has written it, whatever Chrome's exit code. Saved pull requests
given after the folder (`npm run preview:board -- out a.json b.json`, in
the fixtures' shape) add their overview and PR card: how the example pull
requests were checked. The fixtures and saved pull requests carry `raw`:
every file the read tier fetches that answers, by path, saved from git at
the head commit; any other path is a 404. The fixtures keep only the files
whose loss would change a card or a link.

The score gate lives outside the repository, in `SCRATCH/research/gate/`
(`node run.ts`): it runs `loadReview` on the 15 scored pull requests through
a fake fetch (API answers from saved `api.json`, raw files from `git
cat-file` at the head commit, the wasm from `node_modules`) and scores every
link against TypeScript's references and hand judgments, next to the
parser prototype's (spec 2.2.9). It then opens request 56's Python and Go
pull requests, the survey's, and oven-sh/bun#30412 from saved data, and
scores their links against frozen truths: pyright's definitions for
Python, go/types for Go, and Bun's 41 hand-checked Rust links. It judges
every link in each review, the card limit lifted, lists any link no
truth covers, and scans every resolved reference for use sites that are
no use. A link a truth flags counts as wrong until someone reads the code
and records a verdict.

```
src/
  index.ts             driver entry: activate / onEvent
  driver/              runtime, panel channel, open, the parser's
                       download (grammars), navigator, Read all, board
                       marks, camera, storage
  worker/              the parser worker: its side (serve), its entry, and its
                       script as text (generated by npm run worker)
  webview/             the panel: functions the driver serializes into the webview
  shared/              driver ⇄ webview protocol, the examples, Lucide
                       icons and the extension's icon
  lib/                 pure core: GitHub, the read tier (sources), syntax
                       trees, facts, the linker, the grammars' tags.scm
                       (tags), the generic index and resolver (anyfacts,
                       anylink), SHA-256, the line patterns (symbols),
                       diff, highlighting, graph, model, cards, Markdown,
                       layout, string curves and colours, camera and Read
                       all placement, guards, helpers
  lib/langs/           the rule tables of Python, Go and Rust
  lib/fixtures/        honojs/hono#5513 and excalidraw/excalidraw#12237, saved for tests
  vendor/              marked 18.0.9, unchanged; web-tree-sitter 0.27.1, its
                       Node-only branches removed (see its header)
  test/                the fixtures, made-up pull requests, a fake host, a
                       fake fetch, tree-sitter from node_modules
scripts/               marketplace check, preview server, board preview,
                       the parser worker's bundler, the icon's wiring
```

**Code style.** The same as Marie Kondo: functional TypeScript, a pure core
in `src/lib/`, factory functions and closures instead of classes, and
imperative code only at the edges. The marketplace allows no npm imports at
runtime, so the guards and helpers are local, and `marked` and
`web-tree-sitter` are vendored. Relative imports
use `.ts` extensions, so scripts and tests run on Node 24 without a build step.

## Publishing

- `driverId` is `a.pr-blackboard`; the `drawdy.` prefix is reserved.
- Run `npm run check`, push, then `drawdy login` and `drawdy submit`. Follow
  progress with `drawdy submissions`. The marketplace scanner flags `fetch(`
  for its reviewer: PR Blackboard fetches only `api.github.com` and
  `raw.githubusercontent.com` (`src/lib/github.ts`), and the seven pinned
  wasm files from `cdn.jsdelivr.net` (`src/driver/grammars.ts`), each
  checked against its SHA-256.

## Limitations

- Drawdy asks for the board permission when it first delivers a board
  event. PR Blackboard listens from start, so a reader whose permission is
  unanswered (a dev server, or a permission unticked at install) is asked
  on their first board click. Drawdy grants declared permissions at
  install, so in production nobody is asked.
- Cards can't be updated in place, so a card shows a fixed excerpt; Read all
  is the place to see more.
- Strings keep their bend points when a card moves, and DDP 1.3 can't
  move them. A long drag kinks a string near its card; PR Blackboard leaves
  it, and moving the card back puts it back.
- On a dense board not every link gets a string. excalidraw#12237 (31
  changed functions in one thread, 34 links) draws 31: the panel lists 3
  long `calls` that found no route that clears every card without running
  along one of its edges. 24 of the 31 strings have a label; the others
  pass where strings run close on both sides. hono#5513 draws 9 of its 10:
  the imports card's second string, up to `compose()`, finds no route
  clear of `compose.test.ts`; 8 of the 9 have a label, the dashed `tests`
  string's word clearing nowhere on its climb to `fetch()`.
- Links are only as good as what the linker can resolve without types from
  packages: a call through an untyped parameter, an object chosen at run
  time, or a handler typed only through a library's generics has no
  string (on elysia#1734, 4 of 20 true links; on bun#34519, 7 of 51).
- Deleting a card leaves its strings unbound; PR Blackboard leaves them too
  and skips the card's step.
- When an undo takes the board off, the panel goes back to its start view;
  after a redo, opening the panel again picks the board up.
- Components don't appear in exports or screenshots, and always sit above
  drawn shapes.
- Cards keep the theme they were pinned in. A component's iframe can't
  learn Drawdy's theme (its `prefers-color-scheme` follows the browser),
  and a component can't be updated in place, so after a switch of Drawdy's
  theme, or for a teammate in the other theme, the cards keep the pinned
  theme. Read all matches the cards, not Drawdy.
- The PR card's height comes from an estimate; a teammate whose fonts wrap
  longer sees more of the description clipped.
- A crafted description can still cost a few tenths of a second on
  Drawdy's shared worker: dense inline runs up to the lexer's budget
  (about 0.14 s), or 20,000 nested `>` (0.4 s, until `marked` overflows
  its stack and the description shows as plain text). A long run dense
  with `*_~`[]` shows as typed, without its emphasis or links.
- Read all is a floating element: Drawdy draws those over its own chrome,
  so PR Blackboard clips it to the usable view, the screen less the
  toolbar and the panel's strip. The strip is left clear with the panel
  closed too: DDP 1.3 gives no signal that the panel is open, and the
  closed drawer keeps its box. A panel visibility event would let the
  clip stop at the 58 px rail; a floating layer under Drawdy's chrome
  would need no clip.
- Each camera move sends Read all's whole pane again
  (`update-floating-element`, its page included: 15 to 37 KB on hono, up
  to 225 KB on excalidraw), since the clip box is fixed to the screen and
  the pane's scale is a style. Drawdy keeps the iframe, so nothing
  reloads, but its debugger keeps every request in a dev session. An
  update that changes only styles, or floating elements in board space,
  would send a few bytes instead.
- A rebuild's swap is two undo steps, the add and the removal: DDP 1.3
  snapshots history before every scene command.
- In languages the parser doesn't read (Ruby, Java, Kotlin, Swift, C#,
  PHP, C and more), declarations are found by their shape, on formatted
  code, and draw no string; code that doesn't indent its blocks, or
  declarations it doesn't recognise, fall back to file cards.
- Python, Go and Rust link only what their rule tables prove. No string
  for a call through a Go interface or a Rust trait (a call through a
  Python `Protocol` or abstract class links to its own method, never to an
  implementation), an untyped parameter, a call's result with no written
  type, or a Go method promoted from an embedded type. None into a module
  whose file depends on how Python starts (a standard-library name, a
  module two roots hold: CPython's `Lib/test` reaching `Lib/csv.py`; a
  root the reads never asked about), none from an import that may run
  after its file changes `sys.path` (what moves imports from elsewhere
  stays unseen: another module's change, `sys.meta_path`, `.pth` files,
  `PYTHONPATH`, `importlib`), nor into a Go file whose build the
  source's doesn't imply.
  Rust links only inside a file, until the crate's `mod` tree is read.
- Deleted functions have no card: PR Blackboard reads only head files. Their
  lines show on the neighbouring card or the file's card.

## Status

Verified with `npm run typecheck` (clean), `npm test` (23 suites, 401
tests), `npm run check` (all 57 checks; the bundle 792.4 KB unminified,
541 KB of it the parser worker's script) and the score gate
(`node SCRATCH/research/gate/run.ts`, `GATE PASS`; spec 2.2.9):

| Pull requests | Links | Wrong | True links found |
|---|---|---|---|
| JavaScript and TypeScript, the 15 scored | 169 | 0 | 169 of 186, 91 % (bun#34519 86 %, its floor) |
| Python, request 56's 42 | 640 | 0 | 638 of 654, 97.6 % |
| Python, request 56's 8 messy ones | 176 | 0 | 176 of 185, 95.1 % |
| Python, the survey's 17 | 341 | 0 | 339 of 345, 98.3 % |
| Go, request 56's 76 | 1,746 | 0 | 1,243 of 1,335 true calls, 93.2 % |
| Go, the survey's 11 | 295 | 0 | 295 of 316, 93.4 % |
| Rust, oven-sh/bun#30412 | 56 | 0 | its 41 hand-checked links all among the open's links |

A link a truth flags counts as wrong until the code is read: 3, 6, 2 and
24 such links in the Python and Go rows, and Bun's 56, were read and are
right. Every link of each review is judged, not only the board's: opened
again with the card limit lifted, the reviews hold 640, 206, 341, 1,940
and 354 links, none wrong. go/types judges every kind of link on the 76
now (`gotruth-all.ts`), and 29 links in files it can't load (cgo, the
`mlx` build tag, another module) were read by hand and are right. The
gate's scans find no use site that is a declaration's own name, an enum
variant, a name a Rust macro binds, a receiver a macro binds or a type
parameter in 253,357 references. The link review's round 1 cost three
`tests` links on the 42 and the 17, CPython's `Lib/test/test_csv.py`
into `Lib/csv.py`: `import csv` names the standard library's. Its
round 2 lost no true link.

Request 58 changes no JavaScript or TypeScript link: hono#5513's and
excalidraw#12237's reviews and board plans are the same to the byte as
before it (`SCRATCH/perf/same.ts`). Of the other 13 gate boards, the
design round's row-under rule takes 2 strings off elysia#1734, and
ky#883's unchanged caller shows its code. oven-sh/bun#30412 now parses all 37
of its Rust files read, 7.9 MB, and its board draws Rust call chains: 32
cards, 56 links and 32 strings, chains in all 4 of its bands, the longest
8 cards. Before its board picks the cards, the open finds 8,486 links
among 7,789 changed declarations, the 41 links its old board drew from
`rust.ts` among them (the gate replays the open and checks the replay's
review and plan byte for byte). The board shows none of the 41: the
limit, calls first, keeps longer chains from `js_printer/lib.rs`,
`http/lib.rs`, `RequestContext.rs` and `bundle_v2.rs`.

Measured from saved data as request 57 measured (`SCRATCH/perf/bench2.ts`:
raw files from git at the head commit, the parser's files already stored,
the parser in a worker thread, a fresh process each run, the median of 5
runs, 3 with the network). The stall is the longest the shared driver
worker went without answering; the network figures give each API request
300 ms and each raw read 100 ms.

| Pull request | Wall time, before → after request 58 | Same, with the network | CPU | Longest stall |
|---|---|---|---|---|
| hono#5513 | 258 → 253 ms | 2.08 → 2.10 s | 506 → 508 ms | 28 → 29 ms |
| excalidraw#12237 | 838 → 827 ms | 3.85 → 3.84 s | 1.33 → 1.38 s | 50 → 51 ms |
| oven-sh/bun#30412 | 1.76 → 3.20 s | 6.24 → 7.19 s | 2.67 → 4.59 s | 57 → 74 ms |

Bun now parses and links all 37 of its Rust files read, 7.9 MB, where
`rust.ts` read line patterns. The parser worker's tree-sitter memory
stays at the 32 MB it starts with, after Bun's open and after a second
one in the same worker: each tree is deleted once its facts are read (72
made and 72 deleted on Bun's open). The worker's JavaScript heap peaks at
about 508 MB there, 450 MB before request 58. Request 57 took Bun from
3.52 s to 1.81 s, and its stall from 2,563 ms to 59 ms. Where no worker can start, the parser's
script runs on the shared worker and stalls it as long as its longest
step: 53 ms for hono, 223 ms for excalidraw and 1,040 ms for Bun, as
request 57 measured them.

Verified live on drawdy.io (a new local board, the localhost:5173 dev
server's build 127, system Chrome at 1920 × 1080, `SCRATCH/live/harness.mjs`,
2 GitHub requests): python/cpython#152451 opened in 7.4 s with 13 cards,
its methods named `Textbox.do_command()` and the like, and strings
between them, in Drawdy dark and then light. 23 raw reads, 2 jsDelivr
downloads (the runtime and the Python grammar, the first run), no console
errors. The open came before this round's last fix (a Go or Rust local
seen only after its statement, a Python class body read in order); with
it, the gate still builds that pull request's 13 cards, 13 links and 13
strings, none wrong. Request 57's live check of the parser worker (hono#5513: the
worker started and ended idle, the shared worker stalled 35 ms at most)
stands; this round changed neither `driver/parser.ts` nor how the worker
starts.

The toolbar, the whole description and Read all on the board (requests
47–55, and 60's wording) were checked live too: new local boards, system
Chrome at 1920 × 1080, `SCRATCH/live/harness.mjs`, and the build `npm run
check` packs, served by `npm run preview` on localhost:5174, since the
dev server reloaded the extension on each of the parallel round's saves.
Five runs on honojs/hono#5513 cost 6 GitHub requests. The board landed
with the PR card current, `– / 8` and the whole description in the
panel; ›, Description (the PR card at zoom 1), Overview, Home (the start
view, its field focused, the board kept) and a click on the PR card back
to the reading view all worked. `compose()`'s link names took their
strings' colours: `#a578ec` and `#ea8e24` in dark, `#8b5dcf` and
`#ad6300` in light. Read all opened beside its card. Dragged by its
header (cursor `grabbing`, then `grab`), it followed the pointer but for
the first move, which Drawdy spends starting the drag. Zoomed out and in
with the wheel (the card 724 → 448 → 724 px wide, 109 frames each way),
it kept its place against the card on every frame, never off by more
than 0.0001 of the card's width; panned, it moved with the card; Esc
closed it. With Drawdy switched to light after pinning, the cards and
Read all stayed dark, and Rebuild (2 GitHub requests, `Reading the PR`
on the toolbar's line) pinned the new board light. The first open and
the rebuild read 75 raw files each, a later open none (1 request, the
stored copy); jsDelivr served the first run only, and no run logged a
console error.

The UI review's round 1 fixes were checked live the same way, on the
board the earlier runs left, picked up from the stored copy, with 2
GitHub requests: Rebuild pressed twice at once turned off at the first
press, and a third `rebuild` forced past the panel 150 ms later started
nothing; Home while it ran kept the start view, its field focused. The
new board landed after 7.5 s with its PR card on the same 638 × 777 px
of screen at 100 %, the panel still on the start view, and a click on
that card brought the reading view back. No console errors.

Not verified live this round: a Go or Rust board (the gate opens them
from saved data), the download step's words, Rebuild's hold (hono's 2
requests never need it; the panel's tests and `npm run preview:board`
show it), a reload with the panel closed, 1280 × 800 and a teammate's
screen.

## The icon

The extension's icon is a picture, generated outside the repository: a
fanned stack of diff cards tied with a red string and pinned, on deep
charcoal (request 59). The chalkboard before it read as a face at 20 px:
two cards over a U of string. `assets/icon.png`, 512 px, is the
listing's; its 64 px copy, a PNG data URI in `src/shared/app-icon.ts`, is
the 20 px action button's, which Drawdy draws as an image. `npm run icon
-- <listing.png> <64px.png>` wires in both, so trying another candidate is
one command. The art is generated full-bleed, then cut to a rounded
square (radius 181 of 1024) with a 12-of-1024 rim in `#444653`, as the
old tile had. The prompt:

```text
A stack of three cream paper code cards fanned slightly, seen straight on, centred on a deep charcoal background with no chalkboard. Each card shows short thick green and red diff bars. A bold bright red string loops once around the stack and ends in a small pushpin at the upper right. One dominant object.

Square app icon artwork for a developer tool called PR Blackboard, which pins a GitHub pull request to a whiteboard as an investigation board: code cards joined by strings. Polished, softly shaded, modern macOS-style icon illustration. Full-bleed square canvas: no rounded corners, no outer border, no drop shadow around the canvas. Background deep charcoal #1f1f23 at the edges. No text, no letters, no numbers, no logos. It must stay recognisable at 20 by 20 pixels: a few large, bold shapes with strong contrast and generous spacing, nothing thin or fiddly. Important: the composition must not read as a face at small sizes. Never place two similar round or square elements side by side above a curved line or a third element; prefer one dominant object or a clear diagonal arrangement.
```
