import type { CardSummary } from "@mtg/core/contract";
import { Badge } from "@/components/ui/badge";

export function GameChangerBadge() {
  return (
    <Badge variant="outline" className="border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-300">
      Game Changer
    </Badge>
  );
}

export function CardLabel({ card }: { card: CardSummary }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate font-medium">{card.name}</span>
      {card.gameChanger && <GameChangerBadge />}
      {!card.released && <Badge variant="secondary">Preview</Badge>}
    </span>
  );
}
