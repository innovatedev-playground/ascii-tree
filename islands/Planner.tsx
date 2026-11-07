import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import * as T from "../lib/tree.ts";
import type { Row, TreeStyle } from "../lib/tree.ts";

interface Plan {
  id: string;
  /** User-chosen name; when unset the plan is named after its first line. */
  name?: string;
  rows: Row[];
  updated: number;
}

interface Saved {
  plans: Plan[];
  current: string;
  style: TreeStyle;
  markers: boolean;
}

const KEY = "ascii-planner:v1";
const HISTORY_LIMIT = 200;
const DRAG_THRESHOLD = 4;

const STARTER = `Launch the website
├── [x] Scaffold with npm create @frsh/app
├── [~] Pages
│   ├── [x] Home
│   ├── [ ] About
│   └── [ ] Contact form
├── [ ] Content
│   ├── [ ] Write copy
│   └── [ ] Screenshots
└── [ ] Deploy
    ├── [ ] Docker Compose
    └── [ ] DNS + TLS`;

function newPlan(rows: Row[]): Plan {
  return { id: T.newId(), rows, updated: Date.now() };
}

function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    return Array.isArray(s.plans) && s.plans.length ? s : null;
  } catch {
    return null;
  }
}

function planTitle(p: Plan): string {
  return p.name?.trim() || p.rows[0]?.text.trim() || "Untitled plan";
}

function isBlank(rows: Row[]): boolean {
  return rows.every((r) => !r.text.trim());
}

type Focus = { id: string; caret: number | "end" } | null;

interface Drag {
  id: string;
  x0: number;
  y0: number;
  depth0: number;
  active: boolean;
  at: number;
  depth: number;
}

interface Sel {
  anchor: string;
  head: string;
}

interface DropView {
  id: string;
  top: number;
  depth: number;
}

export function Planner() {
  const [ready, setReady] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [current, setCurrent] = useState("");
  const [style, setStyle] = useState<TreeStyle>("unicode");
  const [markers, setMarkers] = useState(true);
  const [mode, setMode] = useState<"tree" | "text">("tree");
  const [focus, setFocus] = useState<Focus>(null);
  const [toast, setToast] = useState("");
  const [drop, setDrop] = useState<DropView | null>(null);
  const [fileOver, setFileOver] = useState(false);
  // Selected lines, from anchor to head (each line includes its children).
  const [sel, setSel] = useState<Sel | null>(null);
  const lastFocus = useRef<string | null>(null);
  const mouseSel = useRef<string | null>(null);

  // Undo history for the current plan. Consecutive edits with the same key
  // (typing in one row, or in the text box) collapse into one step.
  const past = useRef<Row[][]>([]);
  const future = useRef<Row[][]>([]);
  const lastKey = useRef<string | null>(null);

  const drag = useRef<Drag | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const charRef = useRef<HTMLSpanElement>(null);

  const plan = plans.find((p) => p.id === current) ?? plans[0];
  const rows = plan?.rows ?? [];

  // ---- load / save

  useEffect(() => {
    const saved = loadSaved();
    let list = saved?.plans ?? [newPlan(T.parse(STARTER))];
    let cur = saved?.current ?? list[0].id;
    if (saved) {
      setStyle(saved.style === "ascii" ? "ascii" : "unicode");
      setMarkers(saved.markers !== false);
    }
    // Shared link: #p=<base64url ascii tree> opens as a new plan.
    const m = location.hash.match(/^#p=(.+)$/);
    if (m) {
      try {
        const p = newPlan(T.parse(T.decodeShare(m[1])));
        if (p.rows.length) {
          list = [p, ...list];
          cur = p.id;
        }
      } catch { /* bad link: ignore */ }
      history.replaceState(null, "", location.pathname + location.search);
    }
    setPlans(list);
    setCurrent(list.some((p) => p.id === cur) ? cur : list[0].id);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ plans, current, style, markers } satisfies Saved));
    } catch { /* storage full or blocked: keep working in memory */ }
  }, [ready, plans, current, style, markers]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- mutations

  function setRows(next: Row[], key: string | null = null, nextFocus?: Focus) {
    if (next === rows) return;
    if (key === null || key !== lastKey.current) {
      past.current.push(rows);
      if (past.current.length > HISTORY_LIMIT) past.current.shift();
    }
    future.current = [];
    lastKey.current = key;
    setSel(null);
    setPlans((ps) => ps.map((p) => (p.id === plan.id ? { ...p, rows: next, updated: Date.now() } : p)));
    if (nextFocus !== undefined) setFocus(nextFocus);
  }

  function replaceRows(next: Row[]) {
    setPlans((ps) => ps.map((p) => (p.id === plan.id ? { ...p, rows: next, updated: Date.now() } : p)));
  }

  function undo() {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(rows);
    lastKey.current = null;
    replaceRows(prev);
  }

  function redo() {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(rows);
    lastKey.current = null;
    replaceRows(next);
  }

  function switchPlan(id: string) {
    past.current = [];
    future.current = [];
    lastKey.current = null;
    setCurrent(id);
  }

  function addPlan() {
    const p = newPlan([T.row(0, "")]);
    setPlans((ps) => [p, ...ps]);
    switchPlan(p.id);
    setMode("tree");
    setFocus({ id: p.rows[0].id, caret: 0 });
  }

  function renamePlan() {
    const next = prompt("Rename plan (leave empty to use the first line)", plan.name ?? planTitle(plan));
    if (next === null) return;
    const name = next.trim() || undefined;
    setPlans((ps) => ps.map((p) => (p.id === plan.id ? { ...p, name, updated: Date.now() } : p)));
  }

  function deletePlan() {
    if (!confirm(`Delete "${planTitle(plan)}"? This can't be undone.`)) return;
    const rest = plans.filter((p) => p.id !== plan.id);
    const list = rest.length ? rest : [newPlan([T.row(0, "")])];
    setPlans(list);
    switchPlan(list[0].id);
  }

  /** Loads a pasted/dropped tree: into the current plan if it's blank, else as a new plan. */
  function importText(text: string) {
    const parsed = T.parse(text);
    if (!parsed.length) {
      setToast("Nothing to import");
      return;
    }
    if (isBlank(rows)) {
      setRows(parsed);
      setToast(`Loaded ${parsed.length} lines`);
    } else {
      const p = newPlan(parsed);
      setPlans((ps) => [p, ...ps]);
      switchPlan(p.id);
      setToast(`Pasted as new plan · ${parsed.length} lines`);
    }
    setMode("tree");
  }

  // ---- line selection

  /** Selected index range [a, b), widened so every selected line brings its children. */
  function selRange(sl = sel): [number, number] | null {
    if (!sl) return null;
    const ai = rows.findIndex((r) => r.id === sl.anchor);
    const hi = rows.findIndex((r) => r.id === sl.head);
    if (ai < 0 || hi < 0) return null;
    const a = Math.min(ai, hi);
    let b = Math.max(ai, hi) + 1;
    for (let k = a; k < b; k++) b = Math.max(b, T.subtreeEnd(rows, k));
    return [a, b];
  }

  function select(next: Sel | null) {
    if (next) {
      (document.activeElement as HTMLElement | null)?.blur();
      getSelection()?.removeAllRanges();
      listRef.current?.focus({ preventScroll: true });
    }
    setSel(next);
  }

  function selectRange(a: number, b: number) {
    const shown = T.visible(rows).filter((k) => k >= a && k < b);
    select({ anchor: rows[a].id, head: rows[shown[shown.length - 1] ?? a].id });
  }

  /** Ctrl+A ladder: line + children → all siblings → parent branch → … → whole tree. */
  function expandSel() {
    const r = selRange();
    if (!r) return selectRange(0, rows.length);
    const [a, b] = r;
    let d = Infinity, first = a;
    for (let k = a; k < b; k++) {
      if (rows[k].depth < d) {
        d = rows[k].depth;
        first = k;
      }
    }
    let p = first - 1;
    while (p >= 0 && rows[p].depth >= d) p--;
    const sib: [number, number] = p >= 0 ? [p + 1, T.subtreeEnd(rows, p)] : [0, rows.length];
    if (a !== sib[0] || b !== sib[1]) return selectRange(...sib);
    if (p >= 0) selectRange(p, T.subtreeEnd(rows, p));
  }

  function selText(): string {
    const r = selRange();
    return r ? T.render(T.sliceTree(rows, ...r), { style, markers }) : "";
  }

  function deleteSel() {
    const r = selRange();
    if (!r) return;
    const [a, b] = r;
    const rest = T.normalize([...rows.slice(0, a), ...rows.slice(b)]);
    const next = rest.length ? rest : [T.row(0, "")];
    const target = next[Math.max(0, a - 1)];
    setRows(next, null, { id: target.id, caret: "end" });
  }

  /** Moves the selection head one visible line up/down (Shift+↑↓). */
  function extendSel(up: boolean) {
    if (!sel) return;
    const vis = T.visible(rows);
    const vi = vis.indexOf(rows.findIndex((r) => r.id === sel.head));
    const ti = vis[vi + (up ? -1 : 1)];
    if (vi >= 0 && ti !== undefined) select({ anchor: sel.anchor, head: rows[ti].id });
  }

  async function pasteFromClipboard() {
    try {
      importText(await navigator.clipboard.readText());
    } catch {
      setToast("Clipboard blocked: press Ctrl+V instead");
    }
  }

  // ---- global shortcuts and paste (outside text fields)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (sel) {
        if (mod && k === "a") {
          e.preventDefault();
          expandSel();
          return;
        }
        if (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          extendSel(e.key === "ArrowUp");
          return;
        }
        if (!mod && (e.key === "Backspace" || e.key === "Delete")) {
          e.preventDefault();
          deleteSel();
          return;
        }
        if (!mod && !["Shift", "Control", "Meta", "Alt"].includes(e.key)) {
          e.preventDefault();
          const head = sel.head;
          setSel(null);
          setFocus({ id: head, caret: "end" });
          return;
        }
      }
      // Text fields handle their own undo (row inputs route to ours in onRowKey).
      if (t.closest?.("input, textarea, select")) return;
      if (mod && k === "a" && mode === "tree") {
        e.preventDefault();
        expandSel();
        return;
      }
      if (!mod || (k !== "z" && k !== "y")) return;
      e.preventDefault();
      if (k === "y" || e.shiftKey) redo();
      else undo();
    }
    function onPaste(e: ClipboardEvent) {
      const t = e.target as HTMLElement;
      if (!sel && t.closest?.("input, textarea, select")) return;
      const text = e.clipboardData?.getData("text/plain");
      if (!text?.trim()) return;
      e.preventDefault();
      const r = selRange();
      if (r) {
        // Paste over a selection replaces those lines, at the same level.
        const parsed = T.parse(text);
        if (!parsed.length) return;
        const [a, b] = r;
        const depth = Math.min(...rows.slice(a, b).map((x) => x.depth));
        const rest = [...rows.slice(0, a), ...rows.slice(b)];
        setRows(T.insertTree(rest, a, depth, parsed), null, { id: parsed[parsed.length - 1].id, caret: "end" });
        setToast(`Replaced with ${parsed.length} lines`);
        return;
      }
      importText(text);
    }
    function onCopy(e: ClipboardEvent) {
      const r = selRange();
      if (!r) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", selText());
      const n = r[1] - r[0];
      if (e.type === "cut") deleteSel();
      setToast(`${e.type === "cut" ? "Cut" : "Copied"} ${n} line${n === 1 ? "" : "s"}`);
    }
    function onDown(e: PointerEvent) {
      if (sel && !e.shiftKey) setSel(null);
    }
    // Dragging the mouse from one line onto another switches to line selection.
    function onMove(e: PointerEvent) {
      const from = mouseSel.current;
      if (!from || !(e.buttons & 1)) return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-line]");
      const id = el?.dataset.line;
      if (!id || (!sel && id === from) || (sel && sel.head === id)) return;
      select({ anchor: from, head: id });
    }
    function onUp() {
      mouseSel.current = null;
    }
    addEventListener("keydown", onKey);
    addEventListener("paste", onPaste);
    addEventListener("copy", onCopy);
    addEventListener("cut", onCopy);
    addEventListener("pointerdown", onDown);
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
    return () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      removeEventListener("keydown", onKey);
      removeEventListener("paste", onPaste);
      removeEventListener("copy", onCopy);
      removeEventListener("cut", onCopy);
      removeEventListener("pointerdown", onDown);
    };
  });

  // ---- focus management

  useLayoutEffect(() => {
    if (!focus) return;
    const el = listRef.current?.querySelector<HTMLInputElement>(`input[data-row="${focus.id}"]`);
    if (!el) return;
    el.focus();
    const pos = focus.caret === "end" ? el.value.length : focus.caret;
    el.setSelectionRange(pos, pos);
    setFocus(null);
  }, [focus, rows, mode]);

  if (!ready || !plan) {
    return <div class="h-[60vh] animate-pulse rounded-lg border border-line bg-panel" />;
  }

  const vis = T.visible(rows);
  const pre = T.prefixes(rows, style);
  const ascii = T.render(rows, { style, markers });
  const { done, total } = T.progress(rows);

  // ---- row keyboard handling

  function onRowKey(e: KeyboardEvent, i: number) {
    const el = e.currentTarget as HTMLInputElement;
    const r = rows[i];
    const caret = el.selectionStart ?? 0;
    const selEnd = el.selectionEnd ?? caret;
    const vi = vis.indexOf(i);
    const mod = e.ctrlKey || e.metaKey;
    const go = (fn: () => void) => {
      e.preventDefault();
      fn();
    };

    if (mod && e.key.toLowerCase() === "z") {
      return go(() => (e.shiftKey ? redo() : undo()));
    }
    if (mod && e.key.toLowerCase() === "y") return go(redo);
    // Ctrl+A: selects the line's text, then the line + children, then widens from there.
    if (mod && e.key.toLowerCase() === "a" && caret === 0 && selEnd === el.value.length) {
      return go(() => select({ anchor: r.id, head: r.id }));
    }
    if (e.shiftKey && !e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      const ti = vis[vi + (e.key === "ArrowUp" ? -1 : 1)];
      return go(() => select({ anchor: r.id, head: rows[ti ?? i].id }));
    }

    switch (e.key) {
      case "Enter": {
        if (mod) {
          return go(() => setRows(T.update(rows, i, { status: r.status === "done" ? "todo" : "done" })));
        }
        // Enter on an empty line steps out a level, like a bullet list.
        if (!r.text && r.depth > 0 && !T.hasChildren(rows, i)) {
          return go(() => setRows(T.outdent(rows, i), null, { id: r.id, caret: 0 }));
        }
        return go(() => {
          const before = r.text.slice(0, caret);
          const after = r.text.slice(selEnd);
          // Caret at the start of a non-empty row: open a row above instead.
          if (caret === 0 && r.text) {
            const n = T.row(r.depth, "", r.status === "none" ? "none" : "todo");
            setRows(T.insertAt(rows, i, n), null, { id: n.id, caret: 0 });
            return;
          }
          const openParent = T.hasChildren(rows, i) && !r.collapsed;
          const depth = openParent ? r.depth + 1 : r.depth;
          const at = openParent ? i + 1 : T.subtreeEnd(rows, i);
          const n = T.row(depth, after, r.status === "none" ? "none" : "todo");
          const next = T.insertAt(T.update(rows, i, { text: before }), at, n);
          setRows(next, null, { id: n.id, caret: 0 });
        });
      }
      case "Tab":
        return go(() => {
          let next = e.shiftKey ? T.outdent(rows, i) : T.indent(rows, i);
          if (!e.shiftKey && next !== rows) {
            // Indenting under a collapsed row would hide this one: expand it.
            let p = i - 1;
            while (next[p].depth >= next[i].depth) p--;
            if (next[p].collapsed) next = T.update(next, p, { collapsed: false });
          }
          setRows(next, null, { id: r.id, caret });
        });
      case "Backspace": {
        if (mod && e.shiftKey) {
          return go(() => {
            const target = vis[vi - 1] ?? vis[vi + 1];
            setRows(T.removeSubtree(rows, i), null, target !== undefined ? { id: rows[target].id, caret: "end" } : null);
          });
        }
        if (caret !== 0 || selEnd !== 0) return;
        // Backspace at the start removes the checkbox first, then merges the line.
        if (r.status !== "none" && markers) {
          return go(() => setRows(T.update(rows, i, { status: "none" }), null, { id: r.id, caret: 0 }));
        }
        if (T.hasChildren(rows, i)) return;
        const pi = vis[vi - 1];
        if (pi === undefined) return;
        return go(() => {
          // Merge this row's text into the one above (or just delete if empty).
          const prev = rows[pi];
          const merged = T.update(rows, pi, { text: prev.text + r.text });
          setRows(T.removeRow(merged, i), null, { id: prev.id, caret: prev.text.length });
        });
      }
      case "ArrowUp":
      case "ArrowDown": {
        const up = e.key === "ArrowUp";
        if (e.altKey) {
          return go(() => setRows(up ? T.moveUp(rows, i) : T.moveDown(rows, i), null, { id: r.id, caret }));
        }
        const ti = vis[vi + (up ? -1 : 1)];
        if (ti === undefined) return;
        return go(() => setFocus({ id: rows[ti].id, caret: Math.min(caret, rows[ti].text.length) }));
      }
      case ".":
        if (mod && T.hasChildren(rows, i)) {
          return go(() => setRows(T.update(rows, i, { collapsed: !r.collapsed }), null, { id: r.id, caret }));
        }
    }
  }

  /** Multi-line paste into a row inserts it as a branch at that row's level. */
  function onRowPaste(e: ClipboardEvent, i: number) {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!/\r?\n/.test(text.trim())) return;
    const parsed = T.parse(text);
    if (!parsed.length) return;
    e.preventDefault();
    const r = rows[i];
    const lastId = parsed[parsed.length - 1].id;
    if (!r.text) {
      setRows(T.insertTree(T.removeRow(rows, i), i, r.depth, parsed), null, { id: lastId, caret: "end" });
    } else {
      setRows(T.insertTree(rows, T.subtreeEnd(rows, i), r.depth, parsed), null, { id: lastId, caret: "end" });
    }
    setToast(`Inserted ${parsed.length} lines`);
  }

  // ---- drag and drop (pointer events, so it works with touch too)

  function charWidth(): number {
    const el = charRef.current;
    return el ? el.getBoundingClientRect().width / 10 : 8;
  }

  /** Where the dragged branch would land for a pointer at (x, y). */
  function dropTarget(d: Drag, x: number, y: number): { at: number; depth: number; top: number } | null {
    const list = listRef.current;
    const i = rows.findIndex((r) => r.id === d.id);
    if (!list || i < 0) return null;
    const end = T.subtreeEnd(rows, i);
    const moving = new Set(rows.slice(i, end).map((r) => r.id));
    const rest = [...rows.slice(0, i), ...rows.slice(end)];
    const els = [...list.querySelectorAll<HTMLElement>("[data-line]")].filter((el) => !moving.has(el.dataset.line!));
    if (!els.length) return null;

    let gap = 0;
    while (gap < els.length) {
      const b = els[gap].getBoundingClientRect();
      if (y < b.top + b.height / 2) break;
      gap++;
    }
    const listTop = list.getBoundingClientRect().top;
    const top = gap < els.length
      ? els[gap].getBoundingClientRect().top - listTop
      : els[els.length - 1].getBoundingClientRect().bottom - listTop;
    const at = gap < els.length ? rest.findIndex((r) => r.id === els[gap].dataset.line) : rest.length;
    const above = gap > 0 ? rest.find((r) => r.id === els[gap - 1].dataset.line) : undefined;

    // Depth follows the pointer horizontally, one level per 4 characters.
    const max = above ? above.depth + 1 : 0;
    const min = Math.min(max, Math.max(0, (rest[at]?.depth ?? 0) - 1));
    const want = d.depth0 + Math.round((x - d.x0) / (4 * charWidth()));
    return { at, depth: Math.max(min, Math.min(max, want)), top };
  }

  function onGripDown(e: PointerEvent, r: Row) {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: r.id, x0: e.clientX, y0: e.clientY, depth0: r.depth, active: false, at: -1, depth: r.depth };
  }

  function onGripMove(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < DRAG_THRESHOLD) return;
      d.active = true;
    }
    // Scroll the page when dragging near the top or bottom edge.
    if (e.clientY < 48) scrollBy(0, -16);
    else if (e.clientY > innerHeight - 48) scrollBy(0, 16);
    const t = dropTarget(d, e.clientX, e.clientY);
    if (!t) return;
    d.at = t.at;
    d.depth = t.depth;
    setDrop({ id: d.id, top: t.top, depth: t.depth });
  }

  function onGripUp() {
    const d = drag.current;
    drag.current = null;
    setDrop(null);
    if (!d) return;
    if (!d.active) {
      setFocus({ id: d.id, caret: 0 });
      return;
    }
    const i = rows.findIndex((r) => r.id === d.id);
    if (i < 0 || d.at < 0 || (d.at === i && d.depth === rows[i].depth)) return;
    let next = T.moveBlock(rows, i, d.at, d.depth);
    // Dropped as a child of a collapsed row: open it so the move is visible.
    const ni = next.findIndex((r) => r.id === d.id);
    for (let p = ni - 1; p >= 0; p--) {
      if (next[p].depth < next[ni].depth) {
        if (next[p].collapsed) next = T.update(next, p, { collapsed: false });
        break;
      }
    }
    setRows(next);
  }

  function onGripCancel() {
    drag.current = null;
    setDrop(null);
  }

  // ---- file / text drops from outside the page

  function onExternalDrop(e: DragEvent) {
    e.preventDefault();
    setFileOver(false);
    const dt = e.dataTransfer;
    if (!dt) return;
    const file = dt.files[0];
    if (file) file.text().then(importText);
    else importText(dt.getData("text/plain"));
  }

  // ---- toolbar actions

  async function copy() {
    try {
      await navigator.clipboard.writeText(ascii);
      setToast("Copied tree");
    } catch {
      setToast("Clipboard blocked: switch to Text and copy");
    }
  }

  async function share() {
    const url = `${location.origin}${location.pathname}#p=${T.encodeShare(T.render(rows, { markers: true }))}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast("Share link copied");
    } catch {
      prompt("Share link", url);
    }
  }

  function download() {
    const blob = new Blob([ascii + "\n"], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${planTitle(plan).replace(/[^\w.-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "plan"}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---- render

  const range = selRange();
  const draggingId = drop?.id;
  const draggingEnd = draggingId ? T.subtreeEnd(rows, rows.findIndex((r) => r.id === draggingId)) : -1;
  const draggingStart = draggingId ? rows.findIndex((r) => r.id === draggingId) : -1;

  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <label class="sr-only" for="plan-select">Plan</label>
        <select
          id="plan-select"
          class="field min-w-0 flex-1 sm:max-w-xs"
          value={plan.id}
          onChange={(e) => switchPlan((e.currentTarget as HTMLSelectElement).value)}
        >
          {plans.map((p) => <option key={p.id} value={p.id}>{planTitle(p)}</option>)}
        </select>
        <button type="button" class="btn" onClick={pasteFromClipboard} title="Or just press Ctrl+V anywhere">
          Paste tree
        </button>
        <button type="button" class="btn" onClick={addPlan}>New</button>
        <button type="button" class="btn btn-quiet" onClick={renamePlan}>Rename</button>
        <button type="button" class="btn btn-quiet" onClick={deletePlan}>Delete</button>
        <div class="ml-auto flex items-center gap-3 text-sm text-dim">
          {total > 0 && (
            <span class="flex items-center gap-2" title={`${done} of ${total} done`}>
              <span class="h-1.5 w-24 overflow-hidden rounded-full bg-line">
                <span class="block h-full bg-brand transition-all" style={{ width: `${(done / total) * 100}%` }} />
              </span>
              {done}/{total}
            </span>
          )}
          <button type="button" class="btn btn-quiet" onClick={undo} disabled={!past.current.length} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button type="button" class="btn btn-quiet" onClick={redo} disabled={!future.current.length} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
        </div>
      </div>

      <section
        class={`panel ${fileOver ? "border-brand" : ""}`}
        aria-label="ASCII tree"
        onDragOver={(e) => {
          if (!e.dataTransfer?.types.some((t) => t === "Files" || t === "text/plain")) return;
          e.preventDefault();
          setFileOver(true);
        }}
        onDragLeave={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setFileOver(false);
        }}
        onDrop={onExternalDrop}
      >
        <header class="panel-head">
          <div class="seg" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-pressed={mode === "tree"} aria-selected={mode === "tree"} onClick={() => setMode("tree")}>
              Tree
            </button>
            <button type="button" role="tab" aria-pressed={mode === "text"} aria-selected={mode === "text"} onClick={() => setMode("text")}>
              Text
            </button>
          </div>
          <div class="flex flex-wrap items-center gap-1">
            <div class="seg" role="group" aria-label="Characters">
              <button type="button" aria-pressed={style === "unicode"} onClick={() => setStyle("unicode")}>├──</button>
              <button type="button" aria-pressed={style === "ascii"} onClick={() => setStyle("ascii")}>|--</button>
            </div>
            <button type="button" class="btn btn-quiet" aria-pressed={markers} onClick={() => setMarkers(!markers)}>
              [x] marks
            </button>
            <button type="button" class="btn btn-quiet" onClick={copy}>Copy</button>
            <button type="button" class="btn btn-quiet" onClick={download}>.txt</button>
            <button type="button" class="btn btn-quiet" onClick={share}>Share</button>
          </div>
        </header>

        {mode === "text"
          ? (
            <AsciiBox
              value={ascii}
              onChange={(text) => {
                const parsed = T.parse(text);
                // Keep ids and collapsed state for rows that survive the edit unchanged.
                const old = new Map(rows.map((r) => [`${r.depth}\u0000${r.text}`, r]));
                setRows(
                  parsed.map((p) => {
                    const o = old.get(`${p.depth}\u0000${p.text}`);
                    return o ? { ...p, id: o.id, collapsed: o.collapsed } : p;
                  }),
                  "ascii",
                );
              }}
            />
          )
          : (
            <div
              ref={listRef}
              tabIndex={-1}
              class={`relative flex-1 py-3 outline-none font-mono text-sm leading-6 ${drop ? "cursor-grabbing select-none" : ""} ${sel ? "select-none" : ""}`}
            >
              <span ref={charRef} class="invisible absolute whitespace-pre" aria-hidden="true">0000000000</span>
              {(rows.length === 0 || isBlank(rows)) && (
                <div class="px-10 pt-2 pb-4 text-dim">
                  <p>
                    Paste a tree anywhere (<kbd>Ctrl+V</kbd>), drop a <code>.txt</code> file here, or start typing below.
                  </p>
                </div>
              )}
              {rows.length === 0 && (
                <div class="px-10">
                  <button
                    type="button"
                    class="btn"
                    onClick={() => {
                      const n = T.row(0, "");
                      setRows([n], null, { id: n.id, caret: 0 });
                    }}
                  >
                    Add first item
                  </button>
                </div>
              )}
              {vis.map((i) => {
                const r = rows[i];
                const kids = T.hasChildren(rows, i);
                const moving = i >= draggingStart && i < draggingEnd;
                const showMark = markers && r.status !== "none";
                return (
                  <div
                    key={r.id}
                    data-line={r.id}
                    onPointerDown={(e) => {
                      if (!e.shiftKey || e.button !== 0) return;
                      // Shift+click: select from the current line (or selection start) to here.
                      e.preventDefault();
                      select({ anchor: sel?.anchor ?? lastFocus.current ?? r.id, head: r.id });
                    }}
                    class={`group flex items-center pr-2 ${
                      range && i >= range[0] && i < range[1] ? "bg-brand/20" : moving ? "opacity-35" : drop ? "" : "hover:bg-hover focus-within:bg-hover"
                    }`}
                  >
                    <button
                      type="button"
                      class={`w-5 shrink-0 text-center text-dim hover:text-brand ${
                        kids ? (r.collapsed ? "" : "opacity-40 group-hover:opacity-100") : "invisible"
                      }`}
                      title={r.collapsed ? "Expand (Ctrl+.)" : "Fold (Ctrl+.)"}
                      aria-label={r.collapsed ? "Expand" : "Fold"}
                      aria-expanded={kids ? !r.collapsed : undefined}
                      tabIndex={-1}
                      onClick={() => setRows(T.update(rows, i, { collapsed: !r.collapsed }))}
                    >
                      {r.collapsed ? "▸" : "▾"}
                    </button>
                    <span
                      class="flex w-5 shrink-0 cursor-grab touch-none justify-center text-line-strong opacity-0 select-none group-hover:opacity-100 group-focus-within:opacity-100"
                      title="Drag to move (with its children)"
                      aria-hidden="true"
                      onPointerDown={(e) => onGripDown(e, r)}
                      onPointerMove={onGripMove}
                      onPointerUp={onGripUp}
                      onPointerCancel={onGripCancel}
                    >
                      ⠿
                    </span>
                    <span
                      class="cursor-grab touch-none whitespace-pre text-line-strong select-none hover:text-dim"
                      aria-hidden="true"
                      onPointerDown={(e) => onGripDown(e, r)}
                      onPointerMove={onGripMove}
                      onPointerUp={onGripUp}
                      onPointerCancel={onGripCancel}
                    >
                      {pre[i]}
                    </span>
                    {showMark && (
                      <button
                        type="button"
                        class={`status status-${r.status}`}
                        title="Click: [ ] → [~] → [x]"
                        aria-label={`Status: ${r.status}`}
                        tabIndex={-1}
                        onClick={(e) =>
                          setRows(T.update(rows, i, { status: T.nextStatus(r.status) }))}
                      >
                        {T.markerOf(r.status)}
                      </button>
                    )}
                    <input
                      data-row={r.id}
                      aria-label={`Item, level ${r.depth + 1}`}
                      class={`min-w-0 flex-1 bg-transparent outline-none placeholder:text-dim ${
                        r.status === "done" ? "text-dim line-through decoration-line-strong" : ""
                      }`}
                      placeholder={i === 0 ? "Plan title" : "Item"}
                      value={r.text}
                      spellcheck={false}
                      onInput={(e) =>
                        setRows(T.update(rows, i, { text: (e.currentTarget as HTMLInputElement).value }), `row:${r.id}`)}
                      onKeyDown={(e) => onRowKey(e, i)}
                      onPaste={(e) => onRowPaste(e, i)}
                      onFocus={() => (lastFocus.current = r.id)}
                      onPointerDown={(e) => {
                        if (!e.shiftKey && e.button === 0) mouseSel.current = r.id;
                      }}
                    />
                    {r.collapsed && kids && (
                      <button
                        type="button"
                        class="mr-1 rounded px-1 text-xs text-brand hover:bg-line"
                        title="Expand (Ctrl+.)"
                        tabIndex={-1}
                        onClick={() => setRows(T.update(rows, i, { collapsed: false }))}
                      >
                        … +{T.subtreeEnd(rows, i) - i - 1}
                      </button>
                    )}
                    <span class="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      {markers && r.status === "none" && (
                        <button
                          type="button"
                          class="icon-btn w-auto px-1"
                          title="Add checkbox"
                          aria-label="Add checkbox"
                          tabIndex={-1}
                          onClick={() => setRows(T.update(rows, i, { status: "todo" }))}
                        >
                          [ ]
                        </button>
                      )}
                      {markers && r.status !== "none" && (
                        <button
                          type="button"
                          class="icon-btn w-auto px-1 line-through"
                          title="Remove checkbox (Backspace at line start)"
                          aria-label="Remove checkbox"
                          tabIndex={-1}
                          onClick={() => setRows(T.update(rows, i, { status: "none" }))}
                        >
                          [ ]
                        </button>
                      )}
                      <button
                        type="button"
                        class="icon-btn"
                        title="Add child"
                        aria-label="Add child"
                        tabIndex={-1}
                        onClick={() => {
                          const n = T.row(r.depth + 1, "", r.status === "none" ? "none" : "todo");
                          const at = r.collapsed ? T.subtreeEnd(rows, i) : i + 1;
                          setRows(T.insertAt(T.update(rows, i, { collapsed: false }), at, n), null, { id: n.id, caret: 0 });
                        }}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        class="icon-btn hover:text-red-400"
                        title="Delete with children (Ctrl+Shift+Backspace)"
                        aria-label="Delete item"
                        tabIndex={-1}
                        onClick={() => setRows(T.removeSubtree(rows, i))}
                      >
                        ×
                      </button>
                    </span>
                  </div>
                );
              })}
              {drop && (
                <div
                  class="pointer-events-none absolute right-2 flex -translate-y-1/2 items-center"
                  style={{ top: `${drop.top}px`, left: `calc(2.5rem + ${drop.depth * 4}ch)` }}
                  aria-hidden="true"
                >
                  <span class="h-2 w-2 shrink-0 rounded-full bg-brand" />
                  <span class="h-0.5 flex-1 bg-brand" />
                </div>
              )}
            </div>
          )}

        <p class="border-t border-line px-4 py-2 text-xs text-dim">
          {mode === "tree"
            ? <>Drag <span class="text-fg">⠿</span> or the branch lines to move; move sideways to change the level. Select lines by dragging across them, <kbd>Shift</kbd>+click, <kbd>Shift+↑↓</kbd>, or <kbd>Ctrl+A</kbd> (repeat to widen).</>
            : <>Edit the tree as plain text. Accepts <code>tree</code> output, indented lists, and markdown checklists.</>}
        </p>
      </section>

      <div
        role="status"
        aria-live="polite"
        class={`pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-fg px-3 py-2 text-sm text-bg shadow-lg transition-opacity ${
          toast ? "opacity-100" : "opacity-0"
        }`}
      >
        {toast}
      </div>
    </div>
  );
}

/** Textarea that shows the rendered tree but doesn't fight the user while typing. */
function AsciiBox({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const lines = (draft ?? value).split("\n").length;
  return (
    <textarea
      aria-label="ASCII tree text"
      class="flex-1 resize-none bg-transparent py-3 pr-4 pl-10 font-mono text-sm leading-6 whitespace-pre outline-none"
      style={{ minHeight: `${Math.max(22, lines * 1.5 + 2)}rem` }}
      wrap="off"
      spellcheck={false}
      value={draft ?? value}
      onFocus={() => setDraft(value)}
      onBlur={() => setDraft(null)}
      onInput={(e) => {
        const text = (e.currentTarget as HTMLTextAreaElement).value;
        setDraft(text);
        onChange(text);
      }}
    />
  );
}
