// TCGplayer links: product pages, search and Mass Entry carts, optionally wrapped in the owner's Impact tracking link
// (`<base>?u=<encoded target>`). Pure: the web app passes in the tracking base it read from its environment.

export const TCGPLAYER_ORIGIN = 'https://www.tcgplayer.com';
/** Hosts Impact serves TCGplayer tracking links from: the vanity host and Impact's own. */
export const TRACKING_HOSTS = ['partner.tcgplayer.com', 'tcgplayer.pxf.io'] as const;
/**
 * Longest outbound (wrapped) cart link. TCGplayer answers 414 past about 8,190 characters (preflight 2026-11-15); a
 * normal 100-card deck is about 4,100, so most decks fit one cart.
 */
export const MAX_CART_URL_CHARS = 8000;

/** Mass Entry joins its lines with this. */
const MASS_ENTRY_SEPARATOR = '||';
/** A vanity tracking link's code, as Impact issues them (`mtg-deck-app`, `KBNV3x`). */
const VANITY_PATH = /^\/[A-Za-z0-9-]+\/?$/;
/** A full Impact tracking link: account, ad and campaign ids. */
const IMPACT_PATH = /^\/c\/\d+\/\d+\/\d+\/?$/;

export interface CartLine {
  name: string;
  quantity: number;
}

/**
 * The tracking link to wrap TCGplayer links in, or null when `raw` is not one. Only the two shapes Impact issues pass:
 * a vanity link on partner.tcgplayer.com or a `/c/<account>/<ad>/<campaign>` link, https, no query or fragment (a
 * landing URL with `irclickid` is one recorded click, never a base).
 */
export function trackingBase(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.search || url.hash || url.username || url.password || url.port) return null;
  if (!(TRACKING_HOSTS as readonly string[]).includes(url.hostname)) return null;
  const path = url.pathname;
  const vanity = url.hostname === 'partner.tcgplayer.com' && VANITY_PATH.test(path) && !path.startsWith('/c/');
  if (!vanity && !IMPACT_PATH.test(path)) return null;
  return `${url.origin}${path}`;
}

/** `target` wrapped in the tracking link, or `target` itself without one. */
export function tcgplayerLink(target: string, base: string | null): string {
  return base ? `${base}?u=${encodeURIComponent(target)}` : target;
}

export function productUrl(tcgplayerId: number): string {
  return `${TCGPLAYER_ORIGIN}/product/${tcgplayerId}`;
}

/** TCGplayer's Magic product search for a card name. */
export function searchUrl(name: string): string {
  return `${TCGPLAYER_ORIGIN}/search/magic/product?productLineName=magic&q=${encodeURIComponent(name)}`;
}

/**
 * Mass Entry prefilled with `<qty> <Name>` lines. Full `//` names, apostrophes and commas need nothing beyond the one
 * encoding (checked live 2026-11-15).
 */
export function massEntryUrl(lines: readonly CartLine[]): string {
  const c = lines.map((l) => `${l.quantity} ${l.name}`).join(MASS_ENTRY_SEPARATOR);
  return `${TCGPLAYER_ORIGIN}/massentry?productline=Magic&c=${encodeURIComponent(c)}`;
}

/**
 * The lines as one or more outbound cart links, each at most `maxChars` long, lines kept in order. Greedy: a cart takes
 * lines until the next would push it past the limit. A single line too long on its own still gets a cart of its own.
 */
export function splitIntoCarts(lines: readonly CartLine[], base: string | null, maxChars: number): string[] {
  const carts: string[] = [];
  let current: CartLine[] = [];
  for (const line of lines) {
    const next = [...current, line];
    if (current.length > 0 && tcgplayerLink(massEntryUrl(next), base).length > maxChars) {
      carts.push(tcgplayerLink(massEntryUrl(current), base));
      current = [line];
    } else {
      current = next;
    }
  }
  if (current.length > 0) carts.push(tcgplayerLink(massEntryUrl(current), base));
  return carts;
}
