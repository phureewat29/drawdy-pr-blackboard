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
   direct imports, and no search for importers.
3. **Parse** (`syntax.ts`, `facts.ts`): tree-sitter (web-tree-sitter
   0.27.1, vendored in `src/vendor/web-tree-sitter.ts`) with the
   TypeScript, TSX and JavaScript grammars. The driver's `grammars.ts`
   downloads them from jsDelivr at pinned versions, checks each against a
   SHA-256 written in `PINS` (`sha256.ts`; the worker has no
   `crypto.subtle`), and keeps them in kv-storage as `{ sha256, blob }`
   under `wasm:runtime`, `wasm:typescript`, `wasm:tsx` and
   `wasm:javascript`; the parser worker asks the driver for each. A pull
   request loads only the grammars its files need, beside the raw reads,
   and none without TypeScript or JavaScript. The tree is flattened into typed
   arrays, then `facts.ts` reads each file's units (the declarations a card
   can stand for), scopes and bindings, sites (every name that refers to
   something), imports, exports and the members of its classes and objects.
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
   repository's own file when the pull request changes it.
5. **Build the review** (`model.ts`): pins and links. In a parsed file a
   changed line belongs to the innermost unit whose range, from its first
   comment to its last line, holds it; other files keep the line patterns
   of `symbols.ts`, which take `fn new` in Rust and name a Rust method's card
   with its type, `GetAddrInfoRequest::then()`. Changed declarations joined by references form threads
   (`graph.ts` gives each a column, callers left, cycles broken). Each
   thread gets at most one context card: the first unchanged function in
   the files read whose code references its entry, and isn't
   `@deprecated`. Then every resolved reference makes a link from the
   innermost card holding it to the card standing for what it names: from
   a test card `tests`, from the context card `context` (reading `calls` or
   `uses` by its references), then `calls` for any call, `uses` for any
   other reference, `imports` for imports alone. Other languages add
   `calls` by name and `imports` from import lines, and nothing else. A
   test hangs under the first thread it covers, and a file card whose
   links all go into one thread hangs under it (lane `under`), so their
   strings run up: hono's imports card hangs under `compose()` and
   `toError()`. A board holds 32 cards, the PR card included: `limit` keeps
   them in fill order (each thread whole with its context card and tests,
   largest first, its cards nearest the entry first, then the bottom row,
   the largest changes first), and `unpinned` counts the functions and
   files left off for the PR card.
6. **Plan the board** (`layout.ts`, with card grids from `card.ts`): bands
   top to bottom, one per thread, with the row under it (its tests and
   hung file cards); columns left to right, 160 apart, every card after
   column 0 as wide as its column, column 0 on the board's left edge.
   Cards in a column stack in the order that keeps strings short and
   parallel: by the rows that call them, then four sweeps by where all
   their links pull them, keeping the order whose strings cross least as
   straight lines. Entries take the band's top, so the first one is level
   with the PR card; every other card's header is level with a row that
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
   three of a kind go into one card. When some link is left over on the
   compact board, it is planned again roomier (`LAYOUT.roomier`): 240
   between columns, then also 58 between stacked cards, room for a second
   lane; the plan drawing more strings, then crossing less, wins. Labels go last, beside a bend between
   two bends. The panel lists every link, drawn or not. `buildReview`
   returns the review with this plan, and keeps its board order as
   `review.order` (`stepsOf` in `layout.ts` leaves out context cards), so
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
stretch before; 59 ms now). Drawdy's driver worker is a `blob:` worker of
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

**Rebuild** (request 48; the panel's control comes with the toolbar). A
`rebuild` message reads the pull request being read from GitHub again,
past this device's copy and the last read (`loadReview`'s `fresh`), and
parses and plans it anew. The new board goes where the old PR card
stands, then the old board's elements go, found by their marks (this
pull request at the board's head commit) just before the add, so the
reader's own notes and strokes stay. DDP 1.3 snapshots history before
every scene command, so that is two undo steps, the add and then the
removal; two undos bring the old board back. Any failure leaves the old
board as it was and puts the error in the reading view's `error`. The
view carries `rebuildCost` when reading GitHub again costs more than 2
requests, and `rebuilding`, the step under way. A removal the rebuild
made is not the reader's (`swept` in the runtime), so the board stays
picked up even when Drawdy reports it before the command answers.

Every element carries a mark in its `meta` (`driver/elements.ts`): the PR,
the head commit and what the element is (`pr`, `pin`, `link`, `label`). A
card's mark also holds its pin id, its name, its size when made and its
fold rows as `[top, line]`; the PR card's also the theme its cards were
pinned in. A string's mark holds its link id, kind and both pin ids. So the
board works from its marks alone, after a reload or on a teammate's
screen. One strict reader takes these marks and nothing else: PR
Blackboard hasn't shipped, so no earlier shape is read. Reviews kept on
the device carry their own version (`REVIEW_VERSION = 9` in
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

**The PR card** (`card.ts`, `markdown.ts`) shows the description as
GitHub-flavoured Markdown with GitHub's styles. `marked` 18.0.9 is vendored
unchanged in `src/vendor/marked.ts` (MIT, its licence header kept, `//
@ts-nocheck`), because the marketplace builds without `node_modules` and
allows only `@drawdy/driver-protocol` as a bare import. `markdown.ts` uses
only its `Lexer` and renders the tokens itself, so every tag on the page is
one it chose and all text is escaped: raw HTML is dropped but for `<br>`,
images become an `Image: alt` chip (nothing is fetched), a bare
`user-attachments` link becomes `Attachment`, links are inert, and a
`<details>` folds to its summary on the card and opens for real in Read
all. Code fences use the cards' own highlighter, and `:tada:` and other
common shortcodes show as emoji (`emojify`), in titles too. A card's height
is fixed when it is made, so `markdownBlocks` estimates each block from
GitHub's metrics, collapsing margins as Chrome does, 2 to 8 % above
Chrome's measure (the preview prints both). A description up to 532 shows
whole; a longer one shows the blocks that fit whole in 500, never ending
on a heading, then `⋯ Read all`. Diff, syntax and Markdown colours are
GitHub's Primer ones.

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
`Reading the pull request…` meanwhile. A click never moves the camera; a
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

**Read all** (`driver/read-all.ts`), the one popover, sits right of its
card. It is a floating overlay in
screen space, so it reads the same at any zoom. Drawdy's popover kind keeps
the position it opened at, so PR Blackboard uses the overlay kind and its
schema's `pointerEvents: "auto"`. It always opens right of its card
(`placeReadAll` in `lib/view.ts`); without room, the camera first pans left,
keeping the zoom, but never so far that the card's right 240 px leave the
screen. On open it reads `camera:get-info` and one `canvas-to-screen` to
learn where the canvas sits, then moves with each `camera:moved-rapid` body
without asking again; it subscribes to `camera:moved-rapid` when it opens
and removes the subscription when it closes. Opens, replacements and
closes run one at a time. The overlay holds one iframe, whose page opens with
the card's own header, sticky, then the code rows, unified and wrapped, a
wrapped line continuing under its own indent. `✕` must be a schema
button, since only those report clicks (`dom:element-clicked`): it sits in
a row of no height before the iframe, and its transform draws it over the
header's right end. On the PR card, Read all shows the title,
meta and whole description. The overlay is as tall as its page, up to
640: `readAllOf` returns the page with a `height(width)` estimate (rows,
wrapped lines, or the PR card's description estimate), which
`placeReadAll` takes, so a two-line function gets a short overlay. The page's only script scrolls to the folded lines or the first
change, a third of the way down, snapped so a whole row starts under the
header. Drawdy lays the overlay out after the page starts, which resets the
scroll, so the script scrolls again on each resize for two seconds or until
the reader scrolls. It sets its own scroller's `scrollTop`:
`scrollIntoView` would also scroll the pages around the iframe. Read all
closes on `✕`, on Esc while the board or the panel has focus, on a click
on another card, and on Next, Previous, a follow or the overview. A click
on empty board leaves it open: Drawdy sends no event for it. Next,
Previous, a follow and the overview also clear Drawdy's selection before
the camera flies, so no card stays selected away from where the reader
is, and Drawdy's toolbar for it never covers the card flown to. A
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
or more, clear of the minimap, the camera stays still. The navigator reads
live rects, so moved cards count. The overview frames the whole board,
centred; it unions each card's `element-rects` itself:
Drawdy's `query-combined-rect` takes only the top-left corner of every
component after the first.

**No highlighter.** Stepping, following a link, a click or a drag changes
nothing on the board: the camera and the panel show where the reader is,
and every string keeps its own colour and width. So PR Blackboard draws no
preview elements and does not subscribe to `scene:elements-updated`.

**The panel** (`webview/`) follows the request-32 design in
[flow-spec.md](flow-spec.md) 7.2 and 7.3: `PANEL_CSS` in `markup.ts` is the
design's stylesheet, and every colour comes from Drawdy's theme vars, which
load first. One paste field, with no button and no `<form>` (Drawdy's
webview sandbox has no `allow-forms`): a paste opens at once and so does
Enter; only the driver's `parsePrUrl` decides what is a GitHub pull
request, and answers anything else with `Only GitHub pull request links
work, like github.com/owner/repo/pull/123.` Errors show in one slot under
the field, only in the start view; a failed open, or a failed action,
comes back there with the link kept.
The start view lists the 13 examples under the field, no heading, each
its tag in its project's colour (`SUGGESTIONS` ships label, title, colour
and changed-file count; `projectColour` colours any pull request of those
repositories), then its title; a row that costs more than the usual 2
GitHub requests says so after its tag (`23 of 60 GitHub requests`, only
Bun's rewrite). Loading shows the tag, then the steps, the parser's
download beside the reads with a muted `· first time only`. The reading view is the header (tag,
`+additions −deletions`, state, title), the nav (`hasPrevious` and
`hasNext` are all Previous and Next need), the current card (name and chip,
`Read all` only when the card hides code, its plain path, its links by
kind; the PR card has no name or path, since the header names it, only
the muted word `Description` and `Read all`, or `No description
provided.`)
and `Open another`, which sends `start`: the start view comes back with
the field focused, the board stays, and a click on any of its cards
brings the reading view back (`boardClick` in the runtime). Every icon is
Lucide 1.53.0 (ISC), inlined from `shared/icons.ts`; the loading marks
sit in `<template>`s in the markup, since the serialized panel script
draws no SVG itself, and Read all's close button is an image of Lucide
`x`, as a schema has no SVG node. `themeCss` (`driver/channel.ts`) gives the panel `--add`,
`--del`, `--add-gut` and `--blue` from the cards' palette for Drawdy's
theme. PR Blackboard keeps no list of opened pull requests, only each stored
review.

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
npm test             # Jest: the pure core, the navigator and the panel
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
strings curving through three bends and 9 one-word labels, one of each
per drawn link, and nothing else, strings into one edge sharing their
tip, strings in the palette's colours, one per card they leave, each
label its string's, the strings into and out of `fetch()` dashed, nothing
grouped, cards in the theme Drawdy shows, no camera move before the add
and one flight after, nine steps without a popover or any change to the
board, each clearing Drawdy's selection, and Read all right of its card at
both sizes with `✕`, and `Open another` back to the start view with the
board kept, a card click bringing the reading view back. Then it boots
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
it lands, close-ups through the step camera, the PR cards, Read all, a
dragged card and the panel's states. It prints each board's links drawn
and not, its string crossings against straight strings, its colours and
how many crossing strings share one, and each description's height as Chrome lays it out, whole and
as the PR card shows it, beside the estimates. It writes HTML and 2× PNG
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
parser prototype's (spec 2.2.9).

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
                       trees, facts, the linker, SHA-256, the line patterns
                       (symbols), diff, highlighting, graph, model, cards,
                       Markdown, layout, string curves and colours, camera
                       and Read all placement, guards, helpers
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
  `raw.githubusercontent.com` (`src/lib/github.ts`), and the four pinned
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
  clear of `compose.test.ts`.
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
- In languages other than TypeScript and JavaScript, declarations are
  found by their shape, on formatted code; code that doesn't indent its
  blocks, or declarations it doesn't recognise, fall back to file cards.
- Deleted functions have no card: PR Blackboard reads only head files. Their
  lines show on the neighbouring card or the file's card.

## Status

Verified with `npm run typecheck` (clean), `npm test` (21 suites, 288
tests), `npm run check` (all 50 checks; the bundle 672.1 KB unminified,
441 KB of it the parser worker's script) and the score gate
(`node SCRATCH/research/gate/run.ts`: on its 15 pull requests, 169
strings drawn, none wrong, and 169 of 186 true links found, 91 %;
bun#34519 at 86 %, its floor; `GATE PASS`).

The speed work of request 57 changes no board: hono#5513's and
excalidraw#12237's reviews and board plans are the same to the byte as
before it (`SCRATCH/perf/same.ts`), and so are oven-sh/bun#30412's, which
keeps its 32 cards and 41 links. Request 53's Rust names then change only
its cards' names, and one more of its 41 links gets a string (32). It gets
the same board whether GitHub sends every patch or leaves big files' out.

Measured from saved data (`SCRATCH/perf/bench2.ts`: raw files from git at
the head commit, the parser's files already stored, a fresh process each
run, the median of 5 runs, 3 for Bun offline). The stall is the longest
the shared driver worker went without answering; the network figures
give each API request 300 ms and each raw read 100 ms.

| Pull request | Wall time, before → after | Same, with the network | CPU | Longest stall |
|---|---|---|---|---|
| hono#5513 | 264 → 269 ms | 2.09 → 2.03 s | 540 → 545 ms | 53 → 31 ms |
| excalidraw#12237 | 977 → 854 ms | 4.86 → 3.88 s | 1.64 → 1.44 s | 230 → 51 ms |
| oven-sh/bun#30412 | 3.52 → 1.81 s | 8.76 → 6.19 s | 4.54 → 2.81 s | 2,563 → 59 ms |

Where no worker can start, the parser's script runs on the shared worker
and stalls it as long as its longest step: 53 ms for hono, 223 ms for
excalidraw and 1,040 ms for Bun.

Verified live on drawdy.io (a new local board, the localhost:5173 dev
server, system Chrome at 1920 × 1080, Drawdy dark then light,
`SCRATCH/perf/live-open.mjs` on `SCRATCH/live/harness.mjs`, 2 GitHub
requests): hono#5513 opened with its ten cards and strings. The parser
worker started, a `blob:` worker inside the driver's, and had ended,
idle, 40 s later. A 5 ms ticker inside the shared driver worker saw it stall
35 ms at most while the pull request opened. 75 raw reads, 2 jsDelivr
downloads (the first run), no console errors. The 20 px button and the
panel's title show the new icon in both themes.

Not verified live this round: a rebuild (the fake host and `npm run check`
test it; the panel has no button for it yet), Read all, a reload with the
panel closed, 1280 × 800, a teammate's screen, and a switch of Drawdy's
theme after pinning (by design the cards keep the pinned theme). This
round changed none of their code.

## The icon

The extension's icon is a picture, generated outside the repository: a
wooden-framed chalkboard with three diff cards pinned to it, joined by
strings. `assets/icon.png`, 512 px, is the listing's; its 64 px copy, a
PNG data URI in `src/shared/app-icon.ts`, is the 20 px action button's,
which Drawdy draws as an image. `npm run icon -- <listing.png> <64px.png>`
wires in both, so trying another candidate is one command. The prompt:

```text
Design a square app icon for a code-review tool named PR Blackboard.

The whole canvas is the icon: a rounded square (corner radius about 20% of the width) in deep charcoal #1E1E21 with a faint lighter rim, filling the canvas edge to edge.

Centred inside: a small blackboard seen straight on, a deep slate chalkboard (#26302C) in a thin warm wooden frame, used as an investigation board. Three cream code cards (#F3EEE3) are pinned to it, each held by a round pin; each card carries two or three short horizontal bars, one green and one coral red, like lines of a code diff. Curved strings run pin to pin between the cards, one lime-green (#C6F000) and one periwinkle blue (#6A8CF0). One four-point lime sparkle at the upper left of the tile.

Flat vector style with soft, minimal shading and crisp edges. Large, simple shapes that stay readable at 20 pixels. No text, letters, numbers, logos or watermark, and nothing outside the rounded square.
```
