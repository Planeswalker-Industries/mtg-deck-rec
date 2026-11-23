"use client";

import type { CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { CommanderPlate } from "@/components/cards/commander-plate";
import { Button } from "@/components/ui/button";
import { displayName } from "@/lib/cards";
import { PHONE_HIT_AREA } from "@/lib/constants";
import { ColorIdentity } from "./color-identity";

const WUBRG = "WUBRG";

/**
 * The commander (or partner pair) picked on the build start, shown on its art plate until the player builds. Change
 * clears the pick and brings the picker back.
 */
export function SelectedCommander({ commanders, onChange }: { commanders: CardSummary[]; onChange: () => void }) {
  const [single] = commanders;
  // A pair plays the union of both colour identities.
  const identity = [...WUBRG].filter((color) => commanders.some((c) => c.colorIdentity.includes(color))).join("");
  return (
    <CommanderPlate as="div" commanders={commanders} priority>
      <div className="flex min-h-28 flex-col justify-between gap-3 p-4 sm:min-h-32 sm:p-5">
        <div className="flex flex-col gap-1">
          <p className="max-w-xl font-heading text-xl font-semibold tracking-tight text-(--wood-ink) text-on-art sm:text-2xl">
            {commanders.map(displayName).join(" and ")}
          </p>
          {/* Two type lines would crowd the plate; the pair's names say enough. */}
          {commanders.length === 1 && single && <p className="max-w-xs text-sm text-(--wood-ink)/85 text-on-art">{single.typeLine}</p>}
        </div>
        <div className="flex items-center justify-between gap-3">
          <ColorIdentity identity={identity} />
          <Button type="button" size="sm" variant="ghost" className={cn("bg-background/70", PHONE_HIT_AREA)} onClick={onChange}>
            Change
          </Button>
        </div>
      </div>
    </CommanderPlate>
  );
}
