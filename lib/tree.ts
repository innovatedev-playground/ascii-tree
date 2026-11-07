// A plan is stored as a flat, ordered list of rows with a depth. That keeps
// outliner operations (indent, move, delete) simple, and maps 1:1 onto the
// lines of an ASCII tree.
//
// Invariants: rows[0].depth === 0, and rows[i].depth <= rows[i - 1].depth + 1.

export type Status = "none" | "todo" | "doing" | "done";

export interface Row {
  id: string;
  depth: number;
  text: string;
  status: Status;
  collapsed?: boolean;
}

export type TreeStyle = "unicode" | "ascii";

export interface RenderOptions {
  style?: TreeStyle;
  markers?: boolean;
}

let seq = 0;
export function newId(): string {
  // Not crypto.randomUUID: it is missing on plain-http LAN origins.
  return `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function row(depth: number, text = "", status: Status = "none"): Row {
  return { id: newId(), depth, text, status };
}

// ---------------------------------------------------------------- render

const GLYPHS = {
  unicode: { branch: "├── ", last: "└── ", pipe: "│   ", gap: "    " },
  ascii: { branch: "|-- ", last: "`-- ", pipe: "|   ", gap: "    " },
};

const MARKER: Record<Status, string> = {
  none: "",
  todo: "[ ] ",
  doing: "[~] ",
  done: "[x] ",
};

/** For each row, whether it is the last child of its parent. */
export function lastFlags(rows: Row[]): boolean[] {
  const flags = new Array<boolean>(rows.length).fill(true);
  // open[d] = index of the most recent row at depth d still awaiting a sibling.
  const open: number[] = [];
  rows.forEach((r, i) => {
    open.length = Math.min(open.length, r.depth + 1);
    const prev = open[r.depth];
    if (prev !== undefined) flags[prev] = false;
    open[r.depth] = i;
  });
  return flags;
}

/** The tree glyphs ("│   ├── ") that go before each row's label. */
export function prefixes(rows: Row[], style: TreeStyle = "unicode"): string[] {
  const g = GLYPHS[style];
  const last = lastFlags(rows);
  // ancestorLast[d] = whether the ancestor at depth d was a last child.
  const ancestorLast: boolean[] = [];
  return rows.map((r, i) => {
    ancestorLast[r.depth] = last[i];
    let prefix = "";
    for (let d = 1; d < r.depth; d++) prefix += ancestorLast[d] ? g.gap : g.pipe;
    if (r.depth > 0) prefix += last[i] ? g.last : g.branch;
    return prefix;
  });
}

export function markerOf(s: Status): string {
  return MARKER[s];
}

export function render(rows: Row[], opts: RenderOptions = {}): string {
  const markers = opts.markers ?? true;
  const pre = prefixes(rows, opts.style);
  return rows.map((r, i) => pre[i] + (markers ? MARKER[r.status] : "") + r.text).join("\n");
}

// ----------------------------------------------------------------- parse

// Tree glyphs from `tree`, `tree --charset=ascii`, and hand-drawn variants,
// plus list bullets ("- ", "* ", "• ", "1. ") when followed by a space.
const PREFIX =
  /^(?:[  │├└─┬┼╰╭┃┣┗━|`+\\]|-(?=[-\s])|[*•](?=\s)|\d+[.)](?=\s))*/;
const STATUS = /^\[([ xX~/>-])\]\s*/;
const TREE_SUMMARY = /^\d+ director(?:y|ies)(?:, \d+ files?)?$/;

function statusOf(ch: string): Status {
  if (ch === " ") return "todo";
  if (ch === "x" || ch === "X") return "done";
  return "doing";
}

/**
 * Parses `tree` output, ASCII trees, indented text, or markdown lists.
 * Depth comes from how far each label is indented, compared with the lines
 * above it, so any consistent indent width works.
 */
export function parse(text: string): Row[] {
  const rows: Row[] = [];
  const widths: number[] = [];
  for (const raw of text.replace(/\t/g, "    ").split(/\r?\n/)) {
    if (!raw.trim() || TREE_SUMMARY.test(raw.trim())) continue;
    const prefix = raw.match(PREFIX)![0];
    let label = raw.slice(prefix.length).trimEnd();
    if (!label) continue;
    // Markdown task lists: "- [ ] thing".
    let status: Status = "none";
    const m = label.match(STATUS);
    if (m) {
      status = statusOf(m[1]);
      label = label.slice(m[0].length);
    }
    const w = prefix.length;
    while (widths.length && widths[widths.length - 1] >= w) widths.pop();
    rows.push(row(widths.length, label, status));
    widths.push(w);
  }
  return rows;
}

// ------------------------------------------------------------ operations
// All operations return a new array and never mutate their input.

/** Index one past the end of row i's subtree. */
export function subtreeEnd(rows: Row[], i: number): number {
  let j = i + 1;
  while (j < rows.length && rows[j].depth > rows[i].depth) j++;
  return j;
}

export function hasChildren(rows: Row[], i: number): boolean {
  return i + 1 < rows.length && rows[i + 1].depth > rows[i].depth;
}

/** Clamp depths so the flat-list invariants hold. */
export function normalize(rows: Row[]): Row[] {
  let prev = -1;
  return rows.map((r) => {
    const depth = Math.max(0, Math.min(r.depth, prev + 1));
    prev = depth;
    return depth === r.depth ? r : { ...r, depth };
  });
}

function shift(rows: Row[], from: number, to: number, by: number): Row[] {
  return rows.map((r, k) => (k >= from && k < to ? { ...r, depth: r.depth + by } : r));
}

export function indent(rows: Row[], i: number): Row[] {
  if (i === 0 || rows[i - 1].depth < rows[i].depth) return rows;
  return shift(rows, i, subtreeEnd(rows, i), 1);
}

/** Moves the row (and its subtree) out to sit right after its parent. */
export function outdent(rows: Row[], i: number): Row[] {
  const d = rows[i].depth;
  if (d === 0) return rows;
  let p = i - 1;
  while (rows[p].depth >= d) p--;
  const end = subtreeEnd(rows, i);
  const block = rows.slice(i, end).map((r) => ({ ...r, depth: r.depth - 1 }));
  const rest = [...rows.slice(0, i), ...rows.slice(end)];
  const at = subtreeEnd(rest, p);
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

function prevSibling(rows: Row[], i: number): number {
  for (let k = i - 1; k >= 0; k--) {
    if (rows[k].depth === rows[i].depth) return k;
    if (rows[k].depth < rows[i].depth) return -1;
  }
  return -1;
}

function nextSibling(rows: Row[], i: number): number {
  const k = subtreeEnd(rows, i);
  return k < rows.length && rows[k].depth === rows[i].depth ? k : -1;
}

export function moveUp(rows: Row[], i: number): Row[] {
  const p = prevSibling(rows, i);
  if (p < 0) return rows;
  const end = subtreeEnd(rows, i);
  return [...rows.slice(0, p), ...rows.slice(i, end), ...rows.slice(p, i), ...rows.slice(end)];
}

export function moveDown(rows: Row[], i: number): Row[] {
  const n = nextSibling(rows, i);
  return n < 0 ? rows : moveUp(rows, n);
}

export function removeSubtree(rows: Row[], i: number): Row[] {
  return normalize([...rows.slice(0, i), ...rows.slice(subtreeEnd(rows, i))]);
}

export function removeRow(rows: Row[], i: number): Row[] {
  return normalize([...rows.slice(0, i), ...rows.slice(i + 1)]);
}

export function insertAt(rows: Row[], at: number, r: Row): Row[] {
  return [...rows.slice(0, at), r, ...rows.slice(at)];
}

/**
 * Moves row i and its subtree so it starts at index `at` of the list with
 * that subtree removed, with the row itself at `depth`.
 */
export function moveBlock(rows: Row[], i: number, at: number, depth: number): Row[] {
  const end = subtreeEnd(rows, i);
  const by = depth - rows[i].depth;
  const block = rows.slice(i, end).map((r) => (by ? { ...r, depth: r.depth + by } : r));
  const rest = [...rows.slice(0, i), ...rows.slice(end)];
  return normalize([...rest.slice(0, at), ...block, ...rest.slice(at)]);
}

/** Inserts parsed rows at `at`, re-rooted so their top level sits at `depth`. */
export function insertTree(rows: Row[], at: number, depth: number, tree: Row[]): Row[] {
  const block = tree.map((r) => ({ ...r, depth: r.depth + depth }));
  return normalize([...rows.slice(0, at), ...block, ...rows.slice(at)]);
}

/** Rows [a, b) as a standalone tree, re-rooted at depth 0. */
export function sliceTree(rows: Row[], a: number, b: number): Row[] {
  const part = rows.slice(a, b);
  const min = Math.min(...part.map((r) => r.depth));
  return normalize(part.map((r) => ({ ...r, depth: r.depth - min })));
}

export function update(rows: Row[], i: number, patch: Partial<Row>): Row[] {
  return rows.map((r, k) => (k === i ? { ...r, ...patch } : r));
}

/** Indices of rows not hidden inside a collapsed ancestor. */
export function visible(rows: Row[]): number[] {
  const out: number[] = [];
  let hideBelow = Infinity;
  rows.forEach((r, i) => {
    if (r.depth > hideBelow) return;
    hideBelow = Infinity;
    out.push(i);
    if (r.collapsed && hasChildren(rows, i)) hideBelow = r.depth;
  });
  return out;
}

export function nextStatus(s: Status): Status {
  return s === "todo" ? "doing" : s === "doing" ? "done" : "todo";
}

export function progress(rows: Row[]): { done: number; total: number } {
  const tracked = rows.filter((r) => r.status !== "none");
  return { done: tracked.filter((r) => r.status === "done").length, total: tracked.length };
}

// ------------------------------------------------------------ share links

export function encodeShare(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeShare(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
