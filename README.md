# PR Blackboard

**Code got fast. Understanding it didn't.**

Pull requests arrive faster than ever, and they keep getting bigger. A
coding agent opens one in minutes; a thousand changed lines is a normal
afternoon. Writing the code is no longer the slow part of shipping.
Understanding it is.

PR Blackboard turns a pull request into a board you can take in at a
glance and walk through in minutes. Every changed function is a card,
joined to the code that calls it and the tests that cover it by labelled
strings, laid out the way the change actually runs.

![honojs/hono#5513 lands on the board, then the panel steps from card to card while the camera follows the strings](https://raw.githubusercontent.com/phureewat29/drawdy-pr-blackboard/main/.github/assets/demo.gif)

## Understanding is the new bottleneck

A diff hands you files in alphabetical order and leaves the rest to you:
where the change starts, what calls it, what it calls, which test covers
it. That works for ten lines. It doesn't work for a hundred files a day.

PR Blackboard draws the rest for you.

- **See the whole change at once.** One board, read left to right: where
  the change starts, then what it calls, then what that calls.
- **Follow the call, not the file list.** A string runs from each call to
  the exact function it reaches, in whatever file it lives.
- **Know who's affected.** Code that didn't change but calls into the
  change is pinned too.
- **Find the proof.** Tests hang right under what they test.
- **Built for the big ones.** Even Bun's 2,188-file rewrite in Rust lands
  as one board you can walk through.

## How it works

![1. Paste a PR link, or pick an example. 2. PR Blackboard reads the changed files and links the code. 3. Follow the strings, step by step.](https://raw.githubusercontent.com/phureewat29/drawdy-pr-blackboard/main/.github/assets/how-it-works.png)

## Made for

- **Keeping up with the queue**: get the shape of each pull request in
  minutes, then read the lines that matter.
- **Agent-written changes**: see what a coding agent actually touched, and
  how it all connects, before you trust it.
- **Joining a new codebase**: open a recent pull request and watch a real
  change travel through the project.
- **Walking your team through a change**: step through the board card by
  card on a shared screen, and add sticky notes as you talk.

## What's on the board

- **The PR card**: the title, the author, what changed, and the whole
  description, rendered the way GitHub shows it.
- **Change cards**: each changed function with its changed lines, and the
  lines that call other cards marked `→`. **Read all** opens the full code
  right on the board; drag it anywhere, and it pans and zooms with the
  board.
- **Strings**: **calls**, **uses**, **tests** and **imports**, each in its
  own colour, so you can follow one across the board. Every string is a
  fact: PR Blackboard draws it only when it can tell exactly where a call
  goes, never from a name alone.

## The panel walks you through it

- **›** and **‹**, or the arrow keys, step through the code in board order,
  and the camera follows.
- For each card, the panel lists what calls it, what it calls and what
  tests it. Each name takes its string's colour; click one to go there.
- **Overview** shows the whole board. **Description** goes to the PR card.
  **Home** takes you back to the examples, and your board stays.
  **Rebuild** reads the pull request again after new commits.

Strings work for **JavaScript, TypeScript, Python, Go and Rust**. Pull
requests in other languages get a card for every change.

## Try it in 30 seconds

1. Click the **PR Blackboard** button on the right edge of the board: the
   stack of cards.
2. Paste a link like `github.com/honojs/hono/pull/5513`, or pick one of 15
   examples from Hono, Vite, Node.js, Svelte, Bun, Prometheus, CPython and
   more.
3. Press **›** and follow the strings.

## Good to know

- Works with public pull requests on GitHub. No account or sign-in.
- GitHub allows 60 requests an hour without signing in. Opening a pull
  request uses 2. A very big one uses more, and its example row says how
  many: Bun's rewrite takes 23.
- The first pull request in a language downloads that language's parser,
  once: 83 KB for the engine, then 38 KB for Go, 49 KB for JavaScript,
  64 KB for Python, 114 KB for Rust or 133 KB for TypeScript. It's kept on
  your device after that.
- The board is yours: move the cards, draw on them, add sticky notes.
- PR Blackboard only reads. It never approves, comments on or changes
  anything on GitHub.
- Links inside the description can't be opened from the board yet.

## Permissions

- **Board**: to pin cards and strings, and to find the boards it pinned
  before.
- **Interface**: to show its panel, its button and the Read all pane.
- **Storage**: to keep the pull requests you open and the language parsers
  on your device.

## Privacy

PR Blackboard talks to GitHub, to read the pull request and its files, and
to jsDelivr, to download the language parsers, each checked against a
fingerprint before it runs. It sends nothing anywhere else: no account, no
tracking.

## Credits

Code is read with [tree-sitter](https://tree-sitter.github.io/) and its
grammars, descriptions are rendered with [marked](https://marked.js.org/),
and the icons are [Lucide](https://lucide.dev/). The test fixtures use
code from [Hono](https://github.com/honojs/hono) and
[Excalidraw](https://github.com/excalidraw/excalidraw), both MIT licensed.
Building or curious how it works? See the
[developer guide](https://github.com/phureewat29/drawdy-pr-blackboard/blob/main/docs/development.md).

MIT licensed.
