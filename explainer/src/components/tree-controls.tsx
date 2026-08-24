'use client';

/**
 * Expand and collapse every disclosure in the tree at once.
 *
 * A CySEC profile is two factors, nine components and seventeen questions; opening them one at a
 * time to read the whole calculation, or closing them one at a time to see the shape, is the only
 * thing on a profile that needs more than one click. Individual toggles stay pure `<details>` and
 * keep working if this never hydrates.
 */
export function TreeControls() {
  const setAll = (open: boolean) => {
    for (const node of document.querySelectorAll('[data-tree] details')) {
      (node as HTMLDetailsElement).open = open;
    }
  };

  return (
    <div className="flex gap-2">
      <Button onClick={() => setAll(true)}>Expand all</Button>
      <Button onClick={() => setAll(false)}>Collapse all</Button>
    </div>
  );
}

function Button({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-hairline-strong px-3.5 py-1.5 text-[12.5px] font-medium text-muted transition-colors hover:bg-[var(--etoro-white-08)] hover:text-ink"
    >
      {children}
    </button>
  );
}
