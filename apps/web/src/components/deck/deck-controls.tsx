"use client";

import Link from "next/link";
import type { Bracket } from "@mtg/core/contract";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { bracketLabel, collectionModeLabel } from "@/lib/labels";
import type { CollectionMode } from "./use-deck-tool";

const BRACKETS: Bracket[] = [1, 2, 3, 4, 5];
const COLLECTION_MODES: CollectionMode[] = ["first", "only", "off"];

export function DeckControls({
  bracket,
  bracketSource,
  estimatedBracket,
  gameChangerCount,
  includeGameChangers,
  onBracketChange,
  onIncludeGameChangersChange,
  collectionMode,
  onCollectionModeChange,
}: {
  bracket: Bracket;
  bracketSource: "inferred" | "user";
  estimatedBracket: Bracket;
  gameChangerCount: number;
  includeGameChangers: boolean;
  onBracketChange: (bracket: Bracket) => void;
  onIncludeGameChangersChange: (include: boolean) => void;
  /** null when there's no saved collection; the control then links to the collection page. */
  collectionMode: CollectionMode | null;
  onCollectionModeChange: (mode: CollectionMode) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <Label htmlFor="bracket">Bracket</Label>
        <Select value={String(bracket)} onValueChange={(value) => onBracketChange(Number(value) as Bracket)}>
          <SelectTrigger id="bracket" size="sm" className="bg-sleeve">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BRACKETS.map((b) => (
              <SelectItem key={b} value={String(b)}>
                {bracketLabel[b]}
                {b === estimatedBracket ? " (estimated)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {bracketSource === "inferred" && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Estimated from {gameChangerCount} Game Changer{gameChangerCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Switch id="include-game-changers" checked={includeGameChangers} onCheckedChange={onIncludeGameChangersChange} />
          <Label htmlFor="include-game-changers">Suggest Game Changers</Label>
        </div>
        {collectionMode === null ? (
          <Link href="/collection/import" className="text-sm font-bold text-primary underline-offset-4 hover:underline">
            Add your collection
          </Link>
        ) : (
          <div className="flex items-center gap-2">
            <Label htmlFor="collection-mode">My collection</Label>
            <Select value={collectionMode} onValueChange={(value) => onCollectionModeChange(value as CollectionMode)}>
              <SelectTrigger id="collection-mode" size="sm" className="bg-sleeve">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLLECTION_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {collectionModeLabel[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}
