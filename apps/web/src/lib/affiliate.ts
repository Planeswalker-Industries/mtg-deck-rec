import { MAX_CART_URL_CHARS, productUrl, searchUrl, splitIntoCarts, tcgplayerLink, trackingBase, type CartLine } from "@mtg/core/shop";

// TCGplayer affiliate links (Impact). The owner's tracking link comes from the environment, so the public repo carries
// none and each deploy can turn links on or off; without it, links go straight to TCGplayer. No script runs on our
// pages: Impact credits the deep link itself. Links never decide which cards are suggested or how they rank.

/** The validated tracking link, or null when NEXT_PUBLIC_TCGPLAYER_AFFILIATE_URL is unset or malformed. */
export function affiliateBase(): string | null {
  return trackingBase(process.env.NEXT_PUBLIC_TCGPLAYER_AFFILIATE_URL);
}

/** Whether TCGplayer links earn a commission on this deploy; the disclosure shows only then. */
export function affiliateOn(): boolean {
  return affiliateBase() !== null;
}

/** A TCGplayer page (product or search) as an outbound link. */
export function cardLink(target: string): string {
  return tcgplayerLink(target, affiliateBase());
}

/** One card on TCGplayer: its product page when the catalog knows the product, else a search for its name. */
export function cardBuyLink(name: string, productId: number | null | undefined): string {
  return cardLink(productId === null || productId === undefined ? searchUrl(name) : productUrl(productId));
}

/** Mass Entry carts for the lines, split so no link is too long for TCGplayer. */
export function cartLinks(lines: readonly CartLine[]): string[] {
  return splitIntoCarts(lines, affiliateBase(), MAX_CART_URL_CHARS);
}

/** Every outbound TCGplayer link opens in a new tab and is marked as paid. */
export const OUTBOUND = { target: "_blank", rel: "sponsored noopener" } as const;
