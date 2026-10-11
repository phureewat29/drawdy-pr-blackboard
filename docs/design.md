# PR Blackboard: design notes

Why PR Blackboard looks and works the way it does: what we learned from dev.fast
Whiteboard, the choices that followed, and what the Driver Protocol does and
doesn't allow. These notes give the reasons; the current design, in full and
up to date with every owner request, is [flow-spec.md](flow-spec.md). For how
the code works, see the [developer guide](development.md).

## The job

A reader drops a link to a public pull request. PR Blackboard turns it into a
board they can find their way around: see the whole change at a glance, read
it in a sensible order, and keep their own notes beside the code. It doesn't
judge the change: no verdicts, approvals or generated write-ups.

## What dev.fast Whiteboard does

Studied at `devdotfast/whiteboard` commit `4120a91` (v0.2.4, 2026-10-08).

- **A desktop app your coding agent writes into.** A copy of Code-OSS on
  Electron, a local server and an MCP server. Claude Code or Codex draws the
  review through about 20 `session_*` tools; Whiteboard itself calls no model.
- **A document, not a canvas.** Sections, Markdown and typed blocks
  (sequence, flow, call-stack diff, schema). React Flow and ELK draw diagrams
  at fixed positions; nothing can be dragged.
- **Every claim points at code.** Nodes and steps carry line anchors pinned
  to a commit, and the server rejects ranges that don't exist.
- **A tour.** Clicking a diagram step opens the code at those lines, step
  after step.
- **Its gaps:** no freeform canvas, no notes between people, a 736 MB app,
  and it needs a local clone.

What PR Blackboard keeps: a diagram rooted at the entry point, every box tied
to real lines, and a tour that moves from diagram to code. What it does
differently: a real canvas the reader can rearrange and write on, no install,
no clone, and no model, so the links come from reading the code itself.

## Choices

**Read like a page.** Left to right, top to bottom: the PR card, each thread
of the change with its tests below it, then the rest. Next and Previous follow
that one order, so where you are on the board and where you are in the panel
always agree.

**Entry point first.** Callers sit left of what they call: the function where
the change starts comes first, level with the PR card. A new helper is easier
to read once you've seen why it's needed.

**Notes are the reader's.** PR Blackboard pins no notes and keeps no room for
them; the reader uses Drawdy's own sticky notes, arrows and pen wherever they
like.

**Native where people will touch it, components where text must be sharp.**
Strings and their labels are ordinary arrows and text, so readers can move
cards, restyle a string or add their own, and they export with the board. Code
needs a monospace face and colour per token, which Drawdy's text elements
don't have. So diff cards and the PR card are iframe components, sharp at
any zoom.

**Fold what readers skim.** Tests fold to their case names, long functions
to their changes. Read all shows the rest, and every card that hides
anything says `Read all` on its last row.

**Per reader, not per board.** Where you are belongs to each reader. It
lives in the driver and shows in the reader's own camera and panel, so
nothing on the shared board changes as someone reads, and every string
keeps its colour.

**Strings a person would pin.** A string runs short and level where it
can: cards in a column stack where their links pull them, a string blocked
by cards runs through a gap between them, and a plain string hangs in a
curve you can see, never pressed against a card's edge. Drawing every link is not the goal; reading them is. So the
board's strings never cross more often than straight lines would, a type
used everywhere gets its nearest three strings, and the panel lists every
link of the current card, drawn or not.

**The board works alone.** Strings, fold rows and Read all work with the
panel closed, after a reload, or on a teammate's screen, from the marks on
the board. The panel
adds what only it can: opening a pull request, walking the cards in order,
every link of a card.

**The description as GitHub shows it.** The PR card renders the
description as GitHub-flavoured Markdown in GitHub's colours, and stops
between blocks, never on a heading, when it is long. Nothing from the
description is fetched or run.

**One control per job.** Next moves on, and the camera shows where; Read
all is offered for every card that hides something, and only those; one
paste field opens a pull request, and Home goes back to it, keeping
the board being read. No list of opened pull requests: the
stored copy of each is enough.

**Colour tells strings apart.** The label says what a string means, so its
colour is free to say which string it is: strings from one card share a
hue, and strings that cross or run close get different ones.

**Examples the makers wrote.** The example pull requests are by each
project's creator or core team, from well-known projects: hono's first,
since its board shows the strings calmly, Bun's rewrite in Rust last.

**No model.** The links come from the diff and the files read: TypeScript
and JavaScript parsed with tree-sitter, each name followed to the
declaration it means (see [flow-spec.md](flow-spec.md) 2.2); other
languages by shape and indentation. It is fast and free, and reading files
costs no GitHub quota. It can't explain intent, which the PR description
does, so that goes on the PR card.

## What the Driver Protocol allows

Checked against `@drawdy/driver-protocol` 1.3.0 and the host at `06c2d42d`.

- A driver can't register its own element type. The `component` element (a
  DOM schema, which may hold an iframe) is the closest thing: it is saved,
  synced, and follows pan and zoom.
- A component can't be updated in place, and its iframe can't message the
  driver. Clicks reach the driver as `scene:click` with canvas coordinates,
  which is why diff cards sit on a fixed row grid.
- Components sit above canvas content, so a shape drawn over a card is
  hidden: strings end at card edges and labels sit beside them.
- Driver iframes run with `allow-scripts` only, so nothing a driver shows
  can open a link or submit a form: the panel's Open button and Enter key
  are plain handlers, not a form.
- Drawdy grants declared permissions at install and asks for the scene
  permission only when one is unanswered, on the first board event. So
  PR Blackboard listens from start, and the board works without the panel.
- `update-drawdy-elements` sets style, meta, lock, group and position, not
  an arrow's points or bends, so strings can't be re-routed after a drag.

## Notes for the Drawdy team

The smallest host changes that would make PR Blackboard better, most useful
first:

1. **Messages between a component's iframe and its driver.** Line-level
   clicks, folding and hover inside a card, without the row grid.
2. **`schema` in `update-drawdy-elements` for components.** Fold a card in
   place, in one undo step, without re-adding it.
3. **An export fallback for components**, so a board exports with its cards.
4. **`query-combined-rect` for components.** It grows the first element's
   rect by only the top-left corner of each other component, so a union of
   cards loses their far edges. PR Blackboard unions `element-rects` itself.
5. **A component iframe that follows Drawdy's theme.** A component's iframe
   takes `prefers-color-scheme` from the browser, never from Drawdy, so
   PR Blackboard fixes each card to the theme shown when it is pinned. A
   message from the host to component iframes on mount and on a theme
   change (`{ type: "drawdy:theme", theme }`), or an iframe that inherits
   the board's scheme, would let cards follow every reader's theme.
6. **A label of an arrow's own, and its bends in `update-drawdy-elements`.**
   Arrows have no label, so a label is a text element beside a bend that
   stays put; and since bends can't be updated, a dragged card kinks its
   strings near it. Setting `points` in the drag's own undo step would let
   PR Blackboard re-route the moved card's strings.
