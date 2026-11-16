"use client";

import type { CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { CommanderPlate } from "@/components/cards/commander-plate";
import { Button } from "@/components/ui/button";
import { displayName } from "@/lib/cards";
import { PHONE_HIT_AREA } from "@/lib/constants";
import { ColorIdentity } from "./color-identity";

/**
 * The commander picked on the build start, shown on its art plate until the player builds. Change clears the pick and
 * brings the picker back.
 */
export function SelectedCommander({ card, onChange }: { card: CardSummary; onChange: () => void }) {
  return (
    <CommanderPlate as="div" commanders={[card]} priority>
      <div className="flex min-h-28 flex-col justify-between gap-3 p-4 sm:min-h-32 sm:p-5">
        <div className="flex flex-col gap-1">
          <p className="max-w-xl font-heading text-xl font-semibold tracking-tight [text-shadow:0_1px_2px_rgb(0_0_0/0.9)] sm:text-2xl">
            {displayName(card)}
          </p>
          <p className="max-w-xs text-sm text-foreground/85 [text-shadow:0_1px_2px_rgb(0_0_0/0.9)]">{card.typeLine}</p>
        </div>
        <div className="flex items-center justify-between gap-3">
          <ColorIdentity identity={card.colorIdentity} />
          <Button type="button" size="sm" variant="ghost" className={cn("bg-background/70", PHONE_HIT_AREA)} onClick={onChange}>
            Change
          </Button>
        </div>
      </div>
    </CommanderPlate>
  );
}
