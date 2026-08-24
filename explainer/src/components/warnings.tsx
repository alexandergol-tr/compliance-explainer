/**
 * Warnings are rendered, never swallowed.
 *
 * Most of them mean "the payload did not carry something I needed" or "this does not reproduce",
 * and both change how much weight to put on the rest of the page. Caution yellow rather than red:
 * none of these are errors, and a page that shouts cannot be read.
 */
export function Warnings({ items }: { items: string[] }) {
  if (items.length === 0) return null;

  return (
    <aside className="flex gap-3 rounded-xl border border-[rgba(237,197,0,0.24)] bg-[rgba(237,197,0,0.08)] px-4 py-3.5">
      <span aria-hidden className="text-caution">
        ⚠
      </span>
      <div className="text-[13px]">
        <h3 className="mb-1 text-[12px] font-semibold tracking-[0.02em] text-caution">
          {items.length === 1 ? 'One thing to be aware of' : `${items.length} things to be aware of`}
        </h3>
        {items.length === 1 ? (
          <p>{items[0]}</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden className="text-caution">
                  •
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
