# PR Blackboard

**Pin a GitHub pull request to your board like an investigation board, and follow the strings.**

Paste a link to a public GitHub pull request. PR Blackboard pins the
evidence to the board: the pull request itself, every changed function as
a card of code, the unchanged code that calls into the change, and the
tests. Labelled strings join the cards: what calls what, what tests what,
what imports what. You read it the way a detective reads a wall: start at
the PR card and follow the strings. Make your own notes with Drawdy's
sticky notes, shapes and pen: it's your board.

## What lands on the board

```
┌────────────┐   ┌──────────────┐  calls  ┌────────────────┐  calls  ┌────────────┐
│ PR card    │   │ #dispatch()  ├────────▶│ #handleError() ├────────▶│ toError()  │
│            │   │              │  calls  └────────────────┘  ┌─────▶│ NEW        │
└────────────┘ ┌╌▶              ├────┐    ┌────────────────┐  │      └─────▲──────┘
┌╌ fetch() ╌╌┐ ╎ └──────────────┘    └───▶│ compose()      ├──┘ calls      │
╎ UNCHANGED  ├╌┘calls                     └───────▲────────┘               │ imports
└╌╌╌╌╌▲╌╌╌╌╌╌┘                                    │ tests                  │
      ╎ tests                            ┌────────┴────────┐       ┌───────┴──────┐
      └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐               │ compose.test.ts │       │ imports      │
                         ╎               └─────────────────┘       └──────────────┘
┌─────────────┐ tests ┌──┴───────────┐
│ onError()   │◀──────┤ hono.test.ts │
└─────────────┘       └──────────────┘
```

- **The PR card**, top left: the title, the author, how many files and
  lines changed, then the description as GitHub shows it: headings, lists,
  task lists, tables, quotes and code blocks in GitHub's colours, and
  `:tada:` as 🎉. A long description stops after the last whole block that
  fits and ends in `⋯ Read all`. Images show as a small `Image` chip:
  PR Blackboard loads nothing from a description. On a big pull request
  the card also says what the board leaves off: `28 functions and 2 files
  not pinned`. Counts group their digits: `2,188 files · +1,009,257 −4,024`.
- **A thread** is a set of changed functions joined by strings. It reads
  left to right: callers on the left, what they call on the right. Its
  entry sits level with the PR card. A pull request with two separate
  changes gets two threads, one below the other.
- **Change cards**: one per changed function. Each shows the function's
  first line, every changed line with two lines around it, and every line
  that calls another card, marked `→`. The rest folds into `⋯ 23 lines`
  (one hidden line just shows). A function that is all new carries a green
  `NEW` chip.
- **The unchanged caller** of each thread's entry is pinned too, with a
  dashed border and an `UNCHANGED` chip, so you see who is affected without
  opening the file.
- **Tests** hang below what they test, with a string up to it. A test file
  covers what it imports and uses, never a function it is merely named
  after: `hono.test.ts` calls `onError()` and `fetch()`, so its strings go
  there, not to the private `#dispatch()` in `hono-base.ts`. In other
  languages a test file sits in the bottom row, with no string.
- **A file that only reaches into one thread** hangs below it too, with a
  string up to what it names: a file whose new imports bring in
  `toError()` hangs under `toError()`. A change inside an import statement
  makes a card named after the file's imports, `css.ts imports`.
- **The bottom row** holds changes that join no thread: a lone function, a
  doc comment, config, docs.
- **Strings** are arrows bound to both cards, hanging in a curve like
  string pinned across a real board. Each carries one word beside it,
  which says what it means: `calls`, `uses`, `tests` or `imports`. Colour
  tells strings apart: the strings leaving one card share its colour, and
  strings from different cards that cross, meet or run close get
  different ones, from eight hues that read on light and dark boards.
  Dashed means unchanged code: a string into or out of an unchanged card.
  A string curves through the gaps between cards in its way, never passes
  behind one, and never runs along any of a card's edges, where it would
  look like the card's border. Strings into one card meet at one point.
  The board's strings cross no more often than straight lines would, and
  a card that many cards use gets the nearest three; the panel lists every
  link either way. Drag a card and its strings' ends follow; the curves
  and labels stay.
- **Cards** take the theme Drawdy shows when you pin them, and keep it.

## Reading

- **Previous and Next** step through the cards in board order: the PR
  card, then each thread left to right, the row under it, then the bottom
  row. `←` and `→` work while the panel has focus. The camera shows each
  card with the cards its strings join when they fit at a zoom where code
  reads (0.8 or closer). Otherwise it shows the card whole and moves toward
  the joined cards to bring their names into view where there is room. It
  keeps the card clear of Drawdy's minimap in the bottom-left corner, and
  stays still when the card is already in view.
- **Where you are** shows in the camera and the panel. Nothing on the
  board changes as you move, so every string keeps its own colour.
- **The panel** heads with the pull request's tag, in its project's colour
  for the example projects, and its lines added and deleted, `+202 −11`,
  in the cards' green and red. For the PR card it shows `Description` and
  `Read all`, or `No description provided.` For any other card it names
  every link by kind: `called by`, `tested by`, `calls`, `imports`, the
  names in board order. Click a name to go there.
- **Click a card** to make it current without moving the camera. Click a
  string or its label to follow it to the card at the other end.
- **With the panel closed**, after a reload, or on a teammate's screen
  with PR Blackboard installed, the board still works: the strings, the
  fold rows and Read all. Only Read all needs the pull request's details;
  it reads this device's copy, or GitHub the first time.
- **Read all** opens the whole function, a test or file's whole diff, or
  the whole description, beside the card, always on its right, at the same
  size at any zoom, with the changed words marked and `→` on the lines that
  call another card. Every card that hides code ends in a row that says
  `Read all`: folded lines (`⋯ 3 lines · Read all`), a test card's code
  (`⋯ Test code · Read all`), or a line too long for the card
  (`⋯ 1 line cut short · Read all`). Click that row, or any fold
  (`⋯ 4 lines`), to open it there, or use the panel's `Read all`. It opens
  with the card's own header and `✕`, is as tall as what it shows, up to
  640 px, and takes the cards' theme. Close it with `✕` or Esc, or by
  clicking another card or moving to another one. A click on empty board
  leaves it open.
- **Overview** shows the whole board.

## Getting started

1. Click the **PR Blackboard** button on the right edge of the board.
2. Paste a link to a public GitHub pull request. It opens as soon as it
   lands in the field, or press Enter. To see one first, pick one of the
   13 under the field, each by the project's creator or core team: pull
   requests from Hono, Prettier, Zod, Vite, Node.js, TanStack Router,
   Astro, Svelte, Elysia, Bun, ky and Excalidraw, and last Bun's rewrite
   in Rust, whose 2,188 files cost 23 of the 60 GitHub requests an hour.
3. The board lands in one go, then press **Next** to read through it.
4. To open another, press **Open another** at the foot of the panel: the
   field and the examples come back. The board you were reading stays on
   the canvas; click any of its cards to read it again.

## Good to know

- **Public pull requests only.** PR Blackboard doesn't sign in to GitHub.
  Without signing in, GitHub allows 60 requests an hour per network.
  Opening a pull request uses 2, plus 1 for every 100 files past the first
  100; a row or the loading view says so when it is more. Opening it again
  uses 1, because PR Blackboard keeps a copy on your device. When they run
  out, the panel says when to try again.
- **How it reads code.** It parses TypeScript and JavaScript with
  tree-sitter and follows each name to the declaration it means, through
  scopes and imports. A string is drawn only when the name resolves, so a
  call through an untyped parameter has no string. On the 15 pull requests
  checked against TypeScript's own references, none of the 169 strings it
  drew was wrong. Other languages are read by the shape of their lines,
  with `calls` and `imports` strings only; in Rust a call gets a string
  only where its file proves it, and a method's card carries its type,
  `GetAddrInfoRequest::then()`. The first TypeScript or JavaScript pull
  request downloads the parser, under 0.5 MB, once.
- **Out of the way.** Drawdy runs every extension in one shared worker.
  PR Blackboard reads and parses a pull request in a worker of its own,
  so other extensions keep answering while even Bun's 2,188-file rewrite
  opens.
- **Big pull requests.** A board holds up to 32 cards, the PR card
  included: whole threads first, largest first, then the rest, the largest
  changes first. On a pull request of more than 40 code files, it reads
  the largest changes in the pull request's main languages, spread across
  its top folders; folders such as `.github/` and `.claude/` don't count as
  code. The PR card counts what is left off.
- A card shows up to 24 rows of code; Read all shows the rest.
- Cards are web content on the board. They sit above drawn shapes and
  don't appear in image exports. Links in a description don't open.
- The whole board arrives as one undo step.
- Cards keep the theme they were pinned in, so a teammate in the other
  theme sees them that way: light cards on a dark canvas, or dark on
  light. To pin them in your theme, delete the board's cards and open the
  pull request again.
- Opening a pull request that's already on the board takes you to it. If
  it has new commits, the new board goes beside the old one.

## Permissions

- **Interface**: to show its panel, its button and Read all.
- **Board**: to pin the pull request and follow your clicks on it, with
  or without the panel open.
- **Storage**: to keep a copy of each pull request you open, so opening it
  again costs a single request, and the parsers, so they download once.

## Privacy

PR Blackboard reads public data from GitHub's API and
raw.githubusercontent.com, and downloads its TypeScript and JavaScript
parsers once from cdn.jsdelivr.net, each checked against a SHA-256 built
into the extension. It sends nothing else anywhere. It loads no images or
links from a pull request's description. Nothing from your board leaves
your browser.

## Status

In development, not yet on Drawdy's marketplace. Every change is checked
by the tests, a check that reproduces the marketplace's build, and a score
gate:
on 15 pull requests checked against TypeScript's own references, none of
the 169 strings it draws is wrong.

Links to GitHub wait until Drawdy lets an extension open a URL.

## Credits

Building or curious how it works? See the
[developer guide](docs/development.md) and the [board spec](docs/flow-spec.md).
The test fixtures are pull requests from [Hono](https://github.com/honojs/hono)
and [Excalidraw](https://github.com/excalidraw/excalidraw) (both MIT). The
description renderer uses [marked](https://github.com/markedjs/marked)
(MIT), bundled in. Code is parsed with
[web-tree-sitter](https://github.com/tree-sitter/tree-sitter) 0.27.1
(MIT), bundled in, and the
[TypeScript](https://github.com/tree-sitter/tree-sitter-typescript) 0.23.2
and [JavaScript](https://github.com/tree-sitter/tree-sitter-javascript)
0.25.0 grammars (MIT), downloaded from jsDelivr. Icons are from
[Lucide](https://lucide.dev) 1.53.0 (ISC), inlined: `link`,
`chevron-left`, `chevron-right`, `circle`, `loader-circle`,
`circle-check` and `x`. The extension's icon was generated with OpenAI
GPT Image 2.5.

MIT licensed.
