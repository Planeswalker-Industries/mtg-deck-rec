import type { PriceEstimate } from "@mtg/core/contract";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { cardBuyLink, OUTBOUND } from "@/lib/affiliate";
import { fromPrice } from "@/lib/format";

/**
 * A card's price under it in a grid, as a small outline button that buys it on TCGplayer (through the affiliate link
 * when it is on). Without a price, the plain "no price" text instead. Sits outside the card's own pocket, which is a
 * link or enlarges the card (`PocketItem.footer`).
 */
export function PriceLink({
  name,
  price,
  productId,
}: {
  name: string;
  price: PriceEstimate | null | undefined;
  productId: number | undefined;
}) {
  if (!price) return <span className="font-mono text-muted-foreground">{fromPrice(price)}</span>;
  return (
    <a
      href={cardBuyLink(name, productId)}
      {...OUTBOUND}
      aria-label={`${fromPrice(price)} for ${name} on TCGplayer`}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-1 font-mono")}
    >
      {fromPrice(price)}
    </a>
  );
}
