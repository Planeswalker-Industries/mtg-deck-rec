import { cn } from "cn";

/** The jobs a card does, as pills. Labels come from the tags both cards share, so they're already deduplicated. */
export function TagPills({
  labels,
  label,
  align = "center",
  className,
}: {
  labels: readonly string[];
  /** What the list is, for screen readers. */
  label: string;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  if (labels.length === 0) return null;
  return (
    <ul
      aria-label={label}
      className={cn(
        "flex flex-wrap gap-1",
        align === "start" ? "justify-start" : align === "end" ? "justify-end" : "justify-center",
        className,
      )}
    >
      {labels.map((text) => (
        <li
          key={text}
          className="rounded-full border border-seam bg-sleeve px-2 py-0.5 text-[11px] leading-tight text-muted-foreground"
        >
          {text}
        </li>
      ))}
    </ul>
  );
}
