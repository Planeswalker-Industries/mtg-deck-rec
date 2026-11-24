import { Library } from "lucide-react";
import { cn } from "cn";

/**
 * Marks a card the player owns: the collection's Library icon in the image's top-left corner, light ink on an onyx dot
 * rather than a status colour (it isn't pressable, and it isn't good or bad). The page's ink (`--foreground`) is dark on
 * paper and would vanish on the dot. `belowZoom` drops it under the zoom magnifier that
 * pressable pockets put in the same corner. Upper part only: the artist line along the bottom stays visible.
 */
export function OwnedCorner({ belowZoom = false }: { belowZoom?: boolean }) {
  return (
    <span
      role="img"
      aria-label="Owned"
      title="Owned"
      className={cn(
        "pointer-events-none absolute left-1 z-10 flex size-6 items-center justify-center rounded-full bg-(--wood-bar)/80 text-(--wood-ink)",
        // The magnifier is size-8 at top-2 of the pocket, whose image starts 4px (p-1) in: its bottom is 36px down
        // the image, so top-10 leaves a 4px gap.
        belowZoom ? "top-10" : "top-1",
      )}
    >
      <Library aria-hidden className="size-3.5" />
    </span>
  );
}
