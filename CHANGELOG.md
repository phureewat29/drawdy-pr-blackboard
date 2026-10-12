# Changelog

## 1.1.0

- Clear takes the PR's cards and lines off the board. It asks first: the
  green check goes ahead, the red cross dismisses. Your own notes stay, and
  undo brings the board back.
- Rebuild asks the same way on a large PR, which uses more of GitHub's
  hourly requests.

## 1.0.0

First release.

- Pin any public GitHub PR to your Drawdy board: each changed function
  becomes a card, joined to the code it calls, its callers and its tests by
  labelled lines.
- Step through the code card by card from the panel, click a name to jump
  along its line, or press Overview to see the whole board.
- Lines are drawn for TypeScript, JavaScript, Python, Go, Rust and Java, and
  only where the parser can prove the link.
- 14 example PRs to try, from Hono, Vite, Node.js, Svelte, Bun, Prometheus,
  CPython and more.
- Read only: no account, no sign-in.
