# Changelog

## Unreleased

### Faster, and off the shared worker

- **Reading and parsing in a worker of its own.** Drawdy runs every
  extension in one shared worker. PR Blackboard now reads a pull
  request's files, parses and links them and plans the board in a worker
  it starts there, so a big pull request no longer stalls the others, or
  its own loading steps. The longest stall of the shared worker while a
  pull request opens: hono#5513 53 to 31 ms, excalidraw#12237 230 to
  51 ms, oven-sh/bun#30412 2.6 s to 59 ms. Where no worker can start, the
  same code runs as before, on the shared worker.
- **Faster, with the same boards.** Steps that grew with the square of a
  big pull request now grow with its size: grouping cards into threads,
  reading a patch, finding declarations by shape, Rust's proven calls,
  the bottom row's order and the card cut. Raw files are read 16 at a
  time, not 8, the file list keeps four pages in flight, and the board is
  planned once, not twice. bun#30412 opens in 1.8 s of work, not 3.5;
  excalidraw#12237 in 0.85 s, not 0.98. Every board is the same to the
  byte, and the score gate the same to the link: 169 strings, none wrong.
- **Rust.** `fn new` counts as a declaration (`new` is a JavaScript
  keyword, and 57 constructors in Bun's rewrite had no card), and a
  method's card takes its type's name, `GetAddrInfoRequest::then()`, so
  two `then()` cards no longer read the same.
- **A file added whole needs no patch.** When GitHub leaves out a big new
  file's patch, PR Blackboard reads the file and counts every line new:
  Bun's rewrite gets the same board however many patches GitHub sends.
- **Rebuild, the driver's side.** The panel can ask to build the board
  being read again from GitHub, past this device's copy; the new board
  takes the old one's place and only then does the old one go, the
  reader's own notes kept. Two undo steps bring the old board back. The
  toolbar's button comes with its design.
- **The icon** is the chalkboard: three pinned diff cards joined by
  strings. `npm run icon` wires in a new one, for the listing and the
  button alike.
- **Removed**: the Lucide `presentation` artwork and `rsvg-convert`; the
  parser's runtime download for a pull request with no TypeScript or
  JavaScript, which never used it.

### Strings that are facts

- **Links come from a parser.** TypeScript and JavaScript are parsed with
  tree-sitter, and each name is followed to the declaration it means,
  through scopes, imports, re-exports and the members of a receiver it can
  name. A string is drawn only when the name resolves. Names in strings,
  comments and object keys, a test's own `app`, another file's function of
  the same name, and calls through an untyped parameter no longer make a
  string. Scored against TypeScript's own references and hand judgments on
  15 pull requests, the old finder drew 51 wrong links of 162; the new one
  draws none of 169 and finds as many as the parser prototype did. On
  elysia#1734, where the owner saw wrong arrows, the board goes from 27
  links, 19 of them wrong, to 16, all right.
- **Fewer strings, said nowhere.** Links the parser can't settle are
  neither drawn nor listed. `mentions` is gone: docs and config link to
  nothing. In other languages (Python, Go, Rust and the rest) only
  `calls` and `imports` remain, and test files sit in the bottom row.
- **What the board reads.** The changed files, the `tsconfig.json` above
  them and their direct imports, all from raw.githubusercontent.com, which
  costs no GitHub request. In nodejs/node and oven-sh/bun a test importing
  `node:events` reaches the changed `lib/events.js` or
  `src/js/node/events.ts`.
- **The parser downloads once.** The tree-sitter runtime and the grammars
  a pull request needs come from jsDelivr at pinned versions, each checked
  against a SHA-256 in the extension, and stay in Drawdy's storage. The
  first open says `Downloading the TypeScript parser · first time only`
  beside `Reading 4 changed files`; later opens don't. A failed download
  or a wrong hash ends in one line by the field, and trying again costs no
  GitHub request. A file the parser can't read, such as Flow code, falls
  back to the line patterns.
- **Two Vite fixes.** A line deleted right before a function belongs to
  that function, so no `asset.ts, other lines` card repeats it. A change
  inside a multi-line import makes a card named `css.ts imports`, with its
  `imports` string.
- **Words that fit the string.** The unchanged caller's string reads
  `calls` or `uses` by what its code does, and any string into or out of
  an unchanged card is dashed.
- **The PR card in the panel** always shows `Description` and `Read all`,
  or `No description provided.`, so the card area is never empty.
- **13 examples**, in the operator's order: Hono, Prettier, Zod, Vite,
  Node.js, TanStack Router, Astro, Svelte, Elysia, Bun, ky, Excalidraw,
  and last Bun's rewrite in Rust, whose row says it costs 23 of the 60
  GitHub requests an hour. Matt Pocock's skills row is gone.
- **Big pull requests.** On more than 40 code files, the board reads the
  largest changes in the main languages, spread across top folders, and
  `.github/`, `.claude/` and other tooling folders are not code: Bun's
  rewrite shows its Rust. The file list comes four pages at a time, the
  loading view says what a big list costs, counts group their digits, the
  file count comes from GitHub's `changed_files`, and the stored copy
  keeps only what the board and Read all need.
- **Renamed to PR Blackboard** (`a.pr-blackboard`).

### Strings that read, and a quieter panel

- **Strings run short and parallel.** Cards in a column stack in the order
  their links pull them, and a string blocked by cards runs flat through a
  gap between them, curving between columns. A plain string hangs in a
  curve you can see, 8 % of its length, so it reads as string, and strings
  into one card meet at their own angles. No string runs along any of a
  card's four edges, where it looked like the card's border. The board's
  strings cross no more often than straight lines would (excalidraw#12237:
  28 against 28, down from 156 against 81). Columns stay 160 apart, or 240
  when strings need room, and stacked cards 48, or 58 for a second lane
  through the gap; a card that many cards use gets the nearest three
  strings. The panel lists every link.
- **Colour tells strings apart.** The label says what a string means; its
  colour, from eight hues that read on light and dark boards, says which
  one it is. Strings from one card share a hue, and strings that cross,
  meet or run close get different ones. Labels take their string's hue.
- **The board's left edge is straight**: the PR card and the unchanged
  callers line up at its left.
- **The PR card stops between blocks**, never on a heading, and shows a
  description that fits whole with no `⋯ Read all`. Its height estimate now
  runs 2 to 8 % above Chrome's measure instead of 14 to 22 %. `⋯ Read all`
  sits right under the last paragraph, and the spare room goes to the
  card's foot.
- **A simpler panel.** One paste field, with no button: a paste or Enter
  opens. Errors show by the field and keep the link. The field asks for a
  GitHub pull request link, and any other link gets a line saying what
  works.
- **Eight example pull requests** under the field, with no heading, each
  by the project's creator or core team: Hono first, then
  mattpocock/skills, Vite, Node.js, Elysia, Bun, ky and Excalidraw. Each row puts its tag, in the
  project's colour, on a line of its own and the title under it. `:tada:`
  shows as 🎉, as on GitHub.
- **Open another** at the foot of the reading view goes back to the start
  view with the field focused. The board being read stays, and a click on
  any of its cards reads it again. Errors show in the start view only.
- **Lucide icons** everywhere: the field's link, Previous and Next, the
  loading marks, Read all's close button and the extension's own icon, a
  board on a stand.
- **Nothing hidden without a way to it.** Every card that hides code ends
  in a row that says `Read all`: folded lines, a test card's code, or a
  line too long for the card. Each such row has one shape, `⋯`, what it
  hides, then `Read all` underlined. The panel offers `Read all` for
  exactly those cards, and every fold row underlines what to click.
- **Read all is as tall as what it shows**, up to 640 px: a two-line
  function opens in a short popover, not a tall empty one. Clicking
  another card while Read all is still loading leaves no stale popover.
- **The panel says why** when it opens on a board it can't pick up. For
  the PR card, which its header already names, it shows no name row, only
  `Description` and `Read all` when the description folds.
- **Moving clears Drawdy's selection**, so a card selected earlier never
  disagrees with where the camera went. So does a click on a fold row, so
  Drawdy's toolbar doesn't cover the board beside Read all. The panel's tag keeps the pull
  request's number however long its name.
- **Drawdy's minimap no longer covers the card you are reading.** The
  camera keeps the current card clear of the minimap's corner, moving it
  right or up the least it takes.
- **Overview shows the whole board**, always. Read all closes the same way
  however it opened: `✕`, Esc, another card or a move, and never on a
  click on empty board.
- **Removed**: links to GitHub, since Drawdy can't open a page for an
  extension yet; colour by kind; `Start with … ›`; the reading view's
  paste field and its examples popover; the
  `Open` button; the toast; the low-quota line; one-line folds; `Read all`
  for cards with no fold row; the `Try` heading; earlier mark versions;
  vitejs/vite#23463; closing Read all on an empty-board click; the
  overview's first-band fallback.

### Curved strings and Markdown

- **Curved strings.** Each string is an arrow through bend points, which
  Drawdy draws as a smooth curve; it sags a little, like string pinned
  across a board. Strings into one card meet at one point. A dragged card
  moves only its strings' ends; labels stay beside their strings, so
  nothing moves after a drag.
- **The board works without the panel.** Strings, fold rows and Read all
  work after a reload or on a teammate's screen; Read all loads the pull
  request's details only when it opens.
- **The description as GitHub shows it.** The PR card, now 640 wide with
  the header every card has, renders the description as GitHub-flavoured
  Markdown in GitHub's colours. Raw HTML, scripts and images never reach a
  card. Read all shows the whole description. Code on every card takes
  GitHub's diff and syntax colours.
- **Removed**: straight-only strings, the label move after a drag and its
  undo step, the plain-text summary, and Board subscriptions waiting for
  the panel.

### The cut pass

The board is an investigation board: one board, and it is the map. This
release cuts what it did twice over, with [github.com/coldteadotai/pr-lens](https://github.com/coldteadotai/pr-lens)
as the yardstick.

- **Cards pinned and joined by strings.** The PR card heads the board. Each
  changed function is a card of its code, the unchanged caller of each
  thread has a dashed card of its own, and tests hang below what they test.
  Strings, each with one word (`calls`, `tests`, `imports`), join each
  card to the line that makes the link. The panel lists every link.
- **Threads.** Functions that call each other form a thread that reads left
  to right, callers first, its entry level with the PR card. Each thread is
  a band with a row under it: its tests, and any file whose links all go
  into it, such as a file that only imports one of its functions.
  Everything else goes to the bottom row.
- **No popover on a click.** A click makes a card current in the panel.
  Nothing on the board changes as the reader moves: the camera and the
  panel show where they are, and every string keeps its own colour. Click a
  string or a label to follow it. **Read all** is the one popover, always
  right of its card, unified and wrapped, opened at the change; its header
  is part of the overlay, with `✕`, and its gutter marks the rows that call
  a card, as the card does.
- **One add call, one undo step, one camera flight.** The board lands whole,
  then the camera flies once to the overview. Steps frame each card at zoom
  0.8 or closer, where code reads.
- **A quieter panel.** Its header shows the pull request's lines added and
  deleted, `+202 −11`, in the same green and red as the cards. Each link
  row lists its cards in board order, the order Next walks.
- **32 cards at most**, the PR card included; the PR card says what was left
  off: `28 functions and 2 files not pinned`.
- **Fixed on drawdy.io**: the panel's Open button and Enter key (a form
  can't submit in Drawdy's webview sandbox); the overview, which fitted only
  part of the board because Drawdy's combined rect drops components' far
  edges; the panel strip, which is 392 px, not 340; Read all now opens
  scrolled to the change.
- **Removed**: the extension's own sticky notes and the note lane above every card,
  Add note, the board title and lane labels, link rows inside cards, `×3`
  counts, the lime ring, the lime bar and the highlighter on the current
  card's strings, the panel's Recent list, the `starts here` string, `CHANGED`
  and `FILE` chips and file dots, unchanged callee cards, the PR card's file
  list and tests bar, the panel's outline, ticks, change counter and stats
  line, Read all's Function/File, Unified/Split and Wrap switches, the
  right-click menu, the `j` `k` and `Home` keys, batches and their retry,
  the 48-card limit and the `N more files` card.
- Boards and stored reviews from earlier builds are recognised and laid out
  again beside the new one.

## 0.1.0

First release.

- **Open a public pull request** from its link, pasted into the panel, or
  try one of four from Hono, ky, Vite and Excalidraw, listed like
  recent ones. The panel shows each step as it loads and how many GitHub
  requests are left this hour.
- **A board you read like a page**: the title, then a PR card (the
  description, the share of tests, the cards in reading order) beside a
  change map, then a numbered card per file, left to right and top to bottom,
  with room around each for notes.
- **Change map**: the changed functions, with arrows from caller to callee,
  and tests below with dashed arrows to what they cover. When too few
  functions can be read, the map shows files and their imports.
- **Code cards** as short excerpts of every change, and a **sticky note**
  beside each saying what changed there and how it connects. Tests fold to
  their case names and generated files to a summary; fold or unfold from the
  right-click menu.
- **Code popover** beside a map box or a card's line: unified or side-by-side,
  changed words marked, jump between changes, wrap, previous and next step,
  and **Add note**, which pins a sticky note to those lines.
- **Navigation**: Overview, previous and next steps, an outline by card
  that ticks off what you've opened, arrow keys, and the card in view marked
  in the panel. The camera moves only when the code is off screen.
- Opening a pull request again goes to it on the board, and costs one GitHub
  request.
