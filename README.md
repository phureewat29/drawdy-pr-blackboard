# PR Blackboard

**Read any PR as one board.**

PRs come in faster every month, and they keep getting bigger. A coding
agent can open a thousand-line PR in a few minutes, and someone on the team
still has to read it.

PR Blackboard pins a GitHub PR to your Drawdy board. Each changed function
becomes a card. Labelled lines run from every call to the function it
reaches, and from every test to the code it covers. The board reads left to
right, from where the change starts to the code it calls, so you can walk
through a big PR one card at a time.

![elysiajs/elysia#1734 on the board: step through it card by card, jump along a line from the panel, open the overview, then paste a PR link](https://raw.githubusercontent.com/phureewat29/drawdy-pr-blackboard/main/.github/assets/demo.gif)

## Why a board

GitHub lists a PR's files from A to Z, and the reviewer rebuilds the call
order in their head. PR Blackboard draws it for you.

- **Calls you can follow.** A line runs from each call to the exact
  function it reaches, in whatever file it lives.
- **Callers included.** Code that didn't change but calls into the change
  gets a card too.
- **Tests next to the code.** Each test sits under the code it tests.
- **Big PRs too.** Excalidraw's 2,611-line PR (#12237, one of the examples)
  opens as one board you can step through.

## How it works

![1. Paste a PR link, or pick an example. 2. PR Blackboard reads the changed files and links the code. 3. Follow the lines, step by step.](https://raw.githubusercontent.com/phureewat29/drawdy-pr-blackboard/main/.github/assets/how-it-works.png)

## Made for

- **Getting through the review queue**: see the shape of each PR in a few
  minutes, then read the lines that matter.
- **PRs from coding agents**: see what the agent touched and how the pieces
  connect before you approve it.
- **Learning a new codebase**: open a recent PR and watch a real change move
  through the project.
- **Walking your team through a change**: step through the board card by
  card on a shared screen, and add sticky notes as you talk.

## What's on the board

- **The PR card**: the title, the author, what changed, and the whole
  description, rendered the way GitHub shows it.
- **Change cards**: each changed function with its changes, and every call
  to another card marked `→`. **Read all** opens the full code right on the
  board; drag it anywhere, and it pans and zooms with the board.
- **Lines**: **calls**, **uses**, **tests** and **imports**. Lines that cross
  or run close get different colours, so you can follow one across the
  board. PR Blackboard draws a line only when it can tell exactly where a
  call goes. It never guesses from a name.

## Stepping through

- **›** and **‹**, or the arrow keys, step through the code in board order,
  and the camera follows.
- For each card, the panel lists what calls it, what it calls and what
  tests it. Each name takes its line's colour; click one to go there.
- **Overview** shows the whole board. **Description** goes to the PR card.
  **Home** takes you back to the examples, and your board stays.
  **Rebuild** reads the PR again after new commits.
- **Clear** takes the PR's cards and lines off the board and goes Home. It
  asks first, your own notes stay, and undo brings the board back.

Lines are drawn for **JavaScript, TypeScript, Python, Go, Rust, Java, C#,
PHP, Elixir and Clojure**, and for the code of **Vue and Svelte**
components. **Kotlin, C, C++, Scala and Haskell** are parsed too: a card
for each changed function or class, no lines yet. PRs in other languages
get a card for every change.

## Try it in 30 seconds

1. Click the **PR Blackboard** button on the right edge of the board: the
   stack of cards.
2. Paste a link like `github.com/elysiajs/elysia/pull/1734`, or pick one of
   13 examples from Elysia, Hono, Vite, Node.js, Svelte, Bun, Prometheus,
   CPython and more.
3. Press **›** and follow the lines.

## Good to know

- Works with public PRs on GitHub. No account or sign-in.
- GitHub allows 60 requests an hour without signing in. Opening a PR uses
  2, and a very big one more: Bun's 2,188-file rewrite takes 23.
- The first PR in a language downloads that language's parser, once: 81 KB
  for the engine, then 17 KB (Clojure) to 392 KB (Scala). It stays on your
  device after that.
- PR Blackboard only reads. It never approves, comments on or changes
  anything on GitHub.
- Links inside the description can't be opened from the board yet.

## Permissions

- **Board**: to pin cards and lines, and to find the boards it pinned
  before.
- **Interface**: to show its panel, its button and the Read all pane.
- **Storage**: to keep the PRs you open and the language parsers on your
  device.

## Privacy

PR Blackboard reads the PR and its files from GitHub and downloads the
language parsers from jsDelivr. Each parser must match a pinned SHA-256
hash before it runs. Apart from those requests it sends nothing, and it has
no account or tracking.

## License

MIT licensed.
