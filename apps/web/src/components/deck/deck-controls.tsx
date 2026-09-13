"use client";

import type { Bracket } from "@mtg/core/contract";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { bracketLabel } from "@/lib/labels";

const BRACKETS: Bracket[] = [1, 2, 3, 4, 5];

export function DeckControls({
  bracket,
  bracketSource,
  estimatedBracket,
  gameChangerCount,
  includeGameChangers,
  onBracketChange,
  onIncludeGameChangersChange,
}: {
  bracket: Bracket;
  bracketSource: "inferred" | "user";
  estimatedBracket: Bracket;
  gameChangerCount: number;
  includeGameChangers: boolean;
  onBracketChange: (bracket: Bracket) => void;
  onIncludeGameChangersChange: (include: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex items-center gap-2">
        <Label htmlFor="bracket">Bracket</Label>
        <Select value={String(bracket)} onValueChange={(value) => onBracketChange(Number(value) as Bracket)}>
          <SelectTrigger id="bracket" size="sm">
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
          <span className="text-xs text-muted-foreground">
            Estimated from {gameChangerCount} Game Changer{gameChangerCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id="include-game-changers"
          size="sm"
          checked={includeGameChangers}
          onCheckedChange={onIncludeGameChangersChange}
        />
        <Label htmlFor="include-game-changers">Suggest Game Changers</Label>
      </div>
    </div>
  );
}
