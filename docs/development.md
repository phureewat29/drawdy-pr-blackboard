# PR Blackboard: developer guide

How to run, change and publish PR Blackboard. For what it does, see the
[README](../README.md); for the full spec, [flow-spec.md](flow-spec.md).

## Run it locally

1. `npm install`, then `npm run dev`.
2. On drawdy.io, open a **local** board, press `⌘K`, run **Add extension dev
   server** and enter `localhost:5173`.
3. Click the PR Blackboard button on the right edge, allow the permissions,
   and open `github.com/honojs/hono/pull/5513`.

Drawdy reloads the extension on every save and closes its panel; click the
button again.

## Scripts

```bash
npm test               # Jest
npm run typecheck
npm run check          # the marketplace build, size and smoke test
npm run build          # dist/a-pr-blackboard.drawdyx
npm run preview        # serve the marketplace build on :5174
npm run preview:board  # render a board to PNG (needs Google Chrome)
npm run worker         # bundle the parser worker into src/worker/script.ts
npm run icon -- <512px.png> <256px.png> <64px.png>
```

## How it works

```
drawdy.io
├── driver (src/index.ts, src/driver/): fetches the PR, pins the board,
│   follows the reader
│   └── parser worker (src/worker/): reads, parses and links the files,
│       builds the review and plans the board
├── panel (src/webview/): link field, loading steps, the current card
└── board: code cards and the labelled lines between them
```

Opening a PR runs one pipeline of pure functions in `src/lib/`:

1. **Fetch** (`github.ts`): the PR and its file list from `api.github.com`.
   That's 2 requests, plus 1 for every 100 files past the first 100; GitHub
   lists 3,000 files at most.
2. **Read** (`sources.ts`): files at the head commit from
   `raw.githubusercontent.com`, which costs no API quota. Up to 40 code and
   40 test files, each under 400,000 characters, plus what linking needs:
   direct imports, `tsconfig.json`, `go.mod`, Java supertypes.
3. **Parse** (`syntax.ts`, `facts.ts`, `anyfacts.ts`): tree-sitter. The
   grammars come from jsDelivr at pinned versions, are checked against the
   SHA-256 in `PINS` (`driver/grammars.ts`) and are kept in kv-storage.
4. **Link**: `linker.ts` for JavaScript and TypeScript; `anylink.ts` with a
   rule table in `langs/` for Python, Go, Rust and Java. A line is drawn
   only when exactly one target is proven; anything unsure draws nothing.
5. **Review** (`model.ts`): a card per changed function, links labelled
   `calls`, `uses`, `imports`, `tests` or `context`, and at most 32 cards per
   board, the PR card included. What's left off is counted on the PR card.
6. **Plan** (`layout.ts` and `layout/`, `card.ts` and `card/`): columns
   left to right from callers to callees, then curved lines routed around
   the cards, labelled and coloured.
7. **Pin** (`driver/open.ts`): one add call, so one undo removes the board.

Steps 2 to 6 run in the parser worker, so a big PR doesn't stall Drawdy.
Its code reaches the driver as text in `src/worker/script.ts`: run
`npm run worker` after changing `src/lib/` or `src/vendor/` (the dev server
does it on save). `npm run check` fails when the script is behind.

## Code map

```
src/
  index.ts        driver entry
  driver/         runtime, opener, rebuilder, navigator, Read all, the
                  panel's view and channel, parser download, camera,
                  storage, loading steps and warnings
  worker/         the parser worker and its generated script
  webview/        the panel
  shared/         driver ⇄ panel protocol, the examples, icons
  lib/            the pure core: GitHub, reading, parsing, linking, review,
                  layout, cards, Markdown
  lib/langs/      rule tables for Python, Go, Rust and Java, a folder
                  each; java/jdk.ts is generated
  lib/facts/      JavaScript and TypeScript facts: units, scopes, imports, sites
  lib/linker/     what each JS/TS expression, type and member is known to be
  lib/model/      the review: changed lines, threads, cards, links, the card limit
  lib/layout/     the plan's stages: columns, routes, strings, labels, colours
  lib/card/       a card's grid and rows, its HTML, the PR card, Read all
  lib/fixtures/   saved PRs for the tests
  vendor/         marked and web-tree-sitter
  test/           fakes and fixtures for the tests
scripts/          check, preview servers, worker bundler, icon
```

**Style.** Functional TypeScript: a pure core in `src/lib/`, factories and
closures instead of classes. The marketplace allows no runtime npm imports
except `@drawdy/driver-protocol`, so `marked` and `web-tree-sitter` are
vendored. Relative imports keep their `.ts` extension, so Node 24 runs the
scripts and tests without a build step.

## Limits

- 32 cards per board; up to 40 code and 40 test files read per PR.
- GitHub allows 60 API requests an hour without a token.
- The bundle must stay under 1 MB (`npm run check`).
- Other languages (Ruby, Kotlin, Swift, C#, PHP, C, Scala and more) get
  cards but no lines.
- Deleted functions get no card: only head files are read.
- Moving a card keeps its lines' bend points (DDP 1.3 can't move them).

## Publishing

1. `npm run check`, then push.
2. `drawdy login`, `drawdy submit`; follow it with `drawdy submissions`.

The marketplace scanner flags `fetch(`. PR Blackboard fetches only
`api.github.com`, `raw.githubusercontent.com` and its pinned parser files
from `cdn.jsdelivr.net`.

## The icon

`npm run icon -- <512px.png> <256px.png> <64px.png>` writes the 512 px master
to `.github/assets/icon.png`, the 256 px copy the marketplace lists to
`.github/assets/icon-256.png` (Drawdy refuses a listing icon over 256 KB),
and the button's 64 px copy into `src/shared/app-icon.ts`.
