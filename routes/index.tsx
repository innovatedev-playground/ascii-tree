import { page } from "./$index.ts";
import { Planner } from "../islands/Planner.tsx";

export default page(function Home() {
  return (
    <div class="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header class="flex flex-wrap items-baseline justify-between gap-2">
        <h1 class="font-mono text-lg font-semibold">
          <span class="text-brand">└──</span> ascii-tree planner
        </h1>
        <p class="text-sm text-dim">
          Paste a tree, drag it into shape, copy it back out. Saved in this browser.
        </p>
      </header>
      <main class="flex-1">
        <Planner />
      </main>
      <footer class="text-xs leading-6 text-dim">
        <kbd>Ctrl+V</kbd> paste a tree · drag <kbd>⠿</kbd> to move · <kbd>Enter</kbd> new line (on empty: step out) ·{" "}
        <kbd>Tab</kbd>/<kbd>Shift+Tab</kbd> nest · <kbd>Alt+↑↓</kbd> move · <kbd>Ctrl+Enter</kbd> done ·{" "}
        <kbd>Ctrl+.</kbd> fold · <kbd>Ctrl+Shift+⌫</kbd> delete branch · <kbd>Shift+↑↓</kbd>/<kbd>Ctrl+A</kbd> select lines · <kbd>Ctrl+Z</kbd> undo
      </footer>
    </div>
  );
});
