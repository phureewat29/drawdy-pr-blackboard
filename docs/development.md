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
│     fetches the PR, parses its code, builds the review, pins it,
│     follows the reader
│                 ▲ messages, checked at runtime (src/shared/protocol.ts)
│                 ▼
├── PR Blackboard panel: webview (src/webview/)
│     link field, loading checklist, the current card and its links
└── on the board: cards (iframe components), strings (curved arrows bound
      to two cards) and their one-word labels
```

Opening a pull request runs one pipeline, each stage a pure function in
`src/lib/`:

1. **Fetch** (`github.ts`): the pull request and its file list from
   `api.github.com`, four pages at a time. A PR's `.diff` URL sends no CORS
   headers, so the diff comes from the files endpoint.
2. **Read the code** (`sources.ts`): from `raw.githubusercontent.com` at
   the head commit, which costs no API quota, up to 8 requests in flight,
   each path once. The changed code files and the tests the parser reads
   (up to 40 of each, under 400,000 characters; past 40, `pickFiles` takes
   the largest changes in the pull request's main languages, spread across
   its top folders); the `tsconfig.json` or `jsconfig.json` nearest each
   changed JavaScript or TypeScript file, its relative `extends` followed,
   for `paths`; the typings a config names; and each changed file's direct
   imports, trying TypeScript's candidates in order (`./client` is
   `client.ts`, …, `client/index.ts`) until one answers. Nothing past the
   direct imports, and no search for importers.
3. **Parse** (`syntax.ts`, `facts.ts`, driver's `grammars.ts`): tree-sitter
   (web-tree-sitter 0.27.1, vendored in `src/vendor/web-tree-sitter.ts`)
   with the TypeScript, TSX and JavaScript grammars, downloaded from
   jsDelivr at pinned versions, checked against a SHA-256 written in
   `PINS` (`sha256.ts`; the worker has no `crypto.subtle`), and kept in
   kv-storage as `{ sha256, blob }` under `wasm:runtime`, `wasm:typescript`,
   `wasm:tsx` and `wasm:javascript`. A pull request loads only the grammars
   its files need, beside the raw reads. The tree is flattened into typed
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
   of `symbols.ts`. Changed declarations joined by references form threads
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
   keeps this plan's board order as `review.order` (`stepsOf` leaves out
   context cards), so the board and the steps share one order and the
   navigator never plans again.
   `buildReview` plans once to fix them.
7. **Pin it** (`driver/open.ts`, `driver/elements.ts`): in free space near
   the camera (`driver/space.ts`), in one `add-drawdy-elements` call: the
   cards, then each string with its label, nothing grouped. That is one
   undo step. Only then does the camera move, once, to the overview.

Every element carries a mark in its `meta` (`driver/elements.ts`): the PR,
the head commit and what the element is (`pr`, `pin`, `link`, `label`). A
card's mark also holds its pin id, its name, its size when made and its
fold rows as `[top, line]`; the PR card's also the theme its cards were
pinned in. A string's mark holds its link id, kind and both pin ids. So the
board works from its marks alone, after a reload or on a teammate's
screen. One strict reader takes these marks and nothing else: PR
Blackboard hasn't shipped, so no earlier shape is read. Reviews kept on
the device carry their own version (`REVIEW_VERSION = 7` in
`driver/store.ts`); a copy of another version is fetched again. A stored
review keeps a file's diff only when it has a card.

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
npm run icon         # render assets/icon.png from src/shared/app-icon.ts (needs rsvg-convert)
```

`npm run check` builds with esbuild as the marketplace does, unminified,
and reports that size. It fails on any import but `@drawdy/driver-protocol`
and on a bundle of 1 MB or more. Then it boots the bundle in a fake Drawdy
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
selection, with no request to jsDelivr. Last, a 32-card board's add
payload stays under 512 KB.

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
                       icon renderer
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

Verified with `npm run typecheck` (clean), `npm test` (12 suites, 222
tests), `npm run check` (all checks, bundle about 238 KB unminified) and
`npm run preview:board` (hono#5513: 8 of 8 links drawn, no crossings, two
colours; excalidraw#12237: 33 of 46 drawn, 28 crossings, as for straight
strings, four colours, no two crossing strings from different
cards sharing one; no string along any card edge on hono, excalidraw,
elysia#1734, bun#34519 or vite#23586; description estimates 2 to 8 %
above Chrome's measure).

Verified live on drawdy.io (new local boards, the localhost:5173 dev
server, system Chrome at 1920 × 1080 and 1280 × 800, Drawdy dark and then
light, the harness `SCRATCH/live/run4.mjs`, 5 GitHub requests):

- The start view in both themes: the field, no button, no heading, the
  eight example rows each its coloured tag above its title at one left
  edge; the list scrolls (444 of 510) while the field stays put.
- A GitLab link gets the GitHub-only error, the link kept.
- hono#5513 opens from its row, its tag shown while loading; ten cards and
  the strings in their colours.
- Next clears Drawdy's selection (its toolbar gone).
- A label click follows `compose()` → `toError()`; Read all at 1280 × 800
  opens right of `#dispatch()`, clear of the panel.
- After a reload with the panel never reopened, a fold row on `compose()`
  opens Read all and a label follows its string.
- The paste field's popover lists the seven other examples with `This
  board stays on the canvas.`; Esc closes it; its row opens
  mattpocock/skills#783 beside hono's board; a pasted vitejs/vite#23586
  link opens too; `not a link` shows the error above the field, gone on
  typing. (Round 6 replaced this field and popover with `Open another`.)
- No console errors.

Round 6 (the harnesses `SCRATCH/live/rev6.mjs`, `rev7.mjs` and
`rev7b.mjs`, the local board from round 5, 1 GitHub request): on
excalidraw#12237 step 4 the current card sits clear of the minimap at
1920 × 1080 and 1280 × 800, and so do steps 5 to 7 at 1280 × 800; the
overview shows the whole board; after a fold-row click Drawdy's
selection is gone, a click on empty board leaves Read all open, and Esc
closes it; `Open another` shows the start view with the field focused,
in light and dark, and a click on a card brings back its reading view;
Open another stays at the foot when the PR card is current; Previous and
Next draw Lucide chevrons; the loading marks turn and tick; Read all's
close button is Lucide `x` (an image, which drawdy.io loads); no console
errors.

Round 4 (the harness `SCRATCH/live/run6.mjs`, one new local board, 1
GitHub request): the PR step's panel shows `Description` and `Read all`
in dark and light; Read all on `toError()` opens 128 px tall from the
panel and from its `⋯ 1 line cut short · Read all` row, at 1920 × 1080
and 1280 × 800, and on `compose()`, `compose.test.ts` and the PR card
640 px with the page scrolling; `⋯ Test code · Read all` opens the test
file's diff; no console errors.

Not verified live: a teammate's screen, and a switch of Drawdy's theme
after pinning (by design the cards keep the pinned theme).
