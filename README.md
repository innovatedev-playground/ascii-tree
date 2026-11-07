# ascii-tree planner

Paste an ASCII tree, drag it into shape, copy it back out.

```
Launch the website
├── [x] Scaffold
├── [~] Pages
│   ├── [x] Home
│   └── [ ] Contact form
└── [ ] Deploy
```

The editor *is* the tree: every line looks exactly like the text you'll copy.
Plans are saved in the browser (localStorage); nothing is sent to a server.

Built with [Fresh 3](https://fresh.deno.dev) (Vite plugin), Preact and Tailwind 4.

## Development (Deno)

Requires Deno 2.x. Deno reads `package.json`, so no separate config is needed.

```sh
deno install            # install npm dependencies into node_modules
deno task dev           # dev server with hot reload → http://localhost:5173
deno task dev --host    # also expose on your LAN
deno task build         # production build → .output/
deno run -A .output/server/index.mjs   # serve the build (PORT=8000 to change port)
deno check islands/Planner.tsx         # type-check
```

npm works too: `npm install`, `npm run dev`, `npm run build`, `node .output/server/index.mjs`.

## Using it

**Getting a tree in**

- `Ctrl+V` anywhere (outside a text field) loads the pasted tree. If the current plan is empty it fills it, otherwise it opens as a new plan.
- Pasting several lines into a line inserts them as a branch at that level.
- Drop a `.txt` file or text onto the panel.
- Share links (`#p=…`) open as a new plan.
- Reads `tree` / `tree --charset=ascii` output, hand-drawn trees, indented text, and markdown lists or checklists (`- [ ] item`).

**Editing**

| Key | Action |
| --- | --- |
| `Enter` | New line at the same level; on an empty line, step out a level |
| `Tab` / `Shift+Tab` | Nest / un-nest |
| `Alt+↑↓` | Move line (with its children) |
| `Backspace` at line start | Remove checkbox, then merge with the line above |
| `Ctrl+Enter` | Toggle done |
| `Ctrl+.` | Fold / unfold (or click ▾ on the left) |
| `Ctrl+Shift+Backspace` | Delete line and its children |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |

Click a checkbox to cycle `[ ]` → `[~]` → `[x]`. Hover a line for add-checkbox, remove-checkbox, add-child and delete buttons.

**Moving**: drag the `⠿` handle or the branch lines. The orange line shows where it lands; move sideways to change the level.

**Selecting**: drag across lines, `Shift+click`, `Shift+↑↓`, or `Ctrl+A` (line text → line + children → siblings → parent → … → whole tree). A selection always includes children. Then `Ctrl+C` copies it as a standalone tree, `Ctrl+X` cuts, `Delete` removes, and `Ctrl+V` replaces it.

**Output**: switch between `├──` and `|--` characters, toggle `[x]` marks, then Copy, download `.txt`, or Share a link. The **Text** tab edits the whole tree as plain text.

## Layout

```
.
├── routes/
│   ├── _app.tsx       # HTML shell
│   └── index.tsx      # page header, footer, shortcut list
├── islands/
│   └── Planner.tsx    # the editor: rows, drag/drop, selection, paste, storage
├── lib/
│   └── tree.ts        # flat row model: parse, render, indent/move/slice
├── style.css          # Tailwind theme + component classes
└── vite.config.ts
```

A plan is a flat list of `{ depth, text, status }` rows, which maps one-to-one onto the lines of the ASCII tree.
