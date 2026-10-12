# Changelog

## 1.0.0

First release.

- **Open a public GitHub PR** from its link, pasted into the panel, or pick
  one of 15 examples from Hono, Prettier, Zod, Vite, Node.js, TanStack
  Router, Astro, Svelte, Elysia, Bun, ky, Excalidraw, Prometheus and
  CPython. The panel shows each step as it loads, and a big PR's example
  row says how many GitHub requests it costs: Bun's rewrite in Rust takes
  23 of the 60 an hour.
- **One board per PR.** The PR card heads it: the title, the author, what
  changed and the whole description, rendered as GitHub-flavoured Markdown.
  Each changed function is a card of its code in GitHub's diff and syntax
  colours, an unchanged caller gets a dashed card, and tests sit under the
  code they test. Calls read left to right, callers first.
- **Strings you can trust.** Labelled strings (`calls`, `uses`, `tests`,
  `imports`) run from each call to the declaration it reaches, which
  tree-sitter finds through scopes and imports. A string is drawn only when
  exactly one declaration is proven, never from a name alone. Strings that
  cross, meet or run close get different colours.
- **Five languages.** Strings for TypeScript, JavaScript, Python, Go and
  Rust; a PR in any other language gets a card for every change. No wrong
  string on 15 TypeScript and JavaScript PRs scored against TypeScript's
  own references and by hand, 50 Python PRs checked against pyright, 85 Go
  PRs checked against Go's type checker, or Bun's Rust rewrite read by
  hand.
- **The panel walks you through it.** ‹ and ›, or the arrow keys, step
  through the code in board order, and the camera follows. For each card
  the panel lists what calls it, what it calls and what tests it, each name
  in its string's colour; click one to go there. The toolbar holds Home,
  Rebuild, Overview and Description.
- **Read all** opens a card's whole code beside it on the board. Drag it by
  its header; it pans and zooms with the board.
- **Rebuild** reads the PR again after new commits and puts the new board
  where the old one stood, your own notes kept. Two undos bring the old
  board back.
- **Big PRs.** On more than 40 code files, the board reads the largest
  changes in the main languages: Bun's 2,188-file rewrite opens as one
  board. Reading, parsing and linking run in a worker of their own, so
  Drawdy stays responsive while a big PR opens.
- **Parsers download once**, from jsDelivr at pinned versions, each checked
  against its SHA-256, and stay on your device.
- **The board is yours.** Move the cards, draw on them and add sticky notes.
  Strings, folded lines and Read all keep working after a reload and on a
  teammate's screen.
- **Read only.** PR Blackboard never approves, comments on or changes
  anything on GitHub, and talks only to GitHub and jsDelivr.
