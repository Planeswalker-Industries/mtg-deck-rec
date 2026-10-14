"use client";

import { Globe, Library, type LucideIcon } from "lucide-react";
import { cn } from "cn";

/** How a pasted deck is upgraded: from every card the commander's decks play, or from the player's own cards. */
export type UpgradePath = "online" | "owned";

const PATHS: { value: UpgradePath; icon: LucideIcon; title: string; note: (hasCollection: boolean) => string }[] = [
  { value: "online", icon: Globe, title: "Best cards online", note: () => "What decks with this commander play" },
  {
    value: "owned",
    icon: Library,
    title: "Cards I own",
    note: (hasCollection) => (hasCollection ? "From your collection" : "Upload your collection first"),
  },
];

/**
 * The paste screen's first choice, two tiles side by side even on a phone. Pressable surfaces edge in blue on hover and
 * focus; the chosen one is filled in blue's tint, the selected state.
 */
export function UpgradePathPicker({
  value,
  onChange,
  hasCollection,
}: {
  value: UpgradePath;
  onChange: (path: UpgradePath) => void;
  hasCollection: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Upgrade with" className="grid grid-cols-2 gap-2">
      {PATHS.map(({ value: path, icon: Icon, title, note }) => {
        const chosen = path === value;
        return (
          <button
            key={path}
            type="button"
            role="radio"
            aria-checked={chosen}
            onClick={() => onChange(path)}
            className={cn(
              "flex min-h-11 flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors duration-180 ease-table",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              chosen ? "border-primary bg-primary/15" : "border-primary/45 bg-background/40 hover:border-primary hover:bg-primary/10",
            )}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Icon aria-hidden className="size-4 shrink-0 text-primary" />
              {title}
            </span>
            <span className="text-xs leading-snug text-muted-foreground">{note(hasCollection)}</span>
          </button>
        );
      })}
    </div>
  );
}
