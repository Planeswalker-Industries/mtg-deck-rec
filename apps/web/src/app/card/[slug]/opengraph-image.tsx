import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheLife, cacheTag } from "next/cache";
import { ImageResponse } from "next/og";
import { displayName } from "@/lib/cards";
import { OG_IMAGE_SIZE, SITE_NAME, USER_AGENT } from "@/lib/constants";
import { getCardPage } from "@/lib/server/recs-cache";

/**
 * The card page's share preview (T101): the card's front face lying on the walnut table, its name beside it. Rendered
 * once per card and cached with the card's data; a share crawler's repeat visit costs no Scryfall fetch.
 */

export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";
// A static alt can't carry the card's name, and generateImageMetadata would move the image off this URL.
export const alt = `A Magic card on the ${SITE_NAME} table, with its name beside it`;

/** Wood and paper tokens from globals.css; Satori reads no CSS variables. */
const COLOURS = {
  wood: "#1c120c", // --wood: the walnut's base
  paper: "#f4e8d7", // --paper, champagne mist 100: the sheet under the name
  ink: "#1b1918", // --ink, onyx 900: the name, far past AA on the paper
  mark: "#775422", // --brass-deep, champagne mist 700: the site's name, 5.6:1 on the paper
  rule: "#9f702d", // --brass, champagne mist 600: the rule above the name
  rim: "rgba(119, 84, 34, 0.25)", // --brass-deep at 25%: the sheet's aged edge, as the `sheet` utility draws it
  rimGlow: "rgba(159, 112, 45, 0.14)", // --brass at 14%: the sheet's inner browning
  vignette: "rgba(8, 4, 2, 0.6)", // the body's edge darkening
  shadow: "rgba(0, 0, 0, 0.55)", // the card's and the sheet's shadow on the table
};

/** Margin around the plate's contents, in px: the card's and the sheet's edges sit this far in. */
const PAD_PX = 48;
/** The sheet's inner margin around the name, in px. */
const SHEET_PAD_PX = 48;
/** The paper tile's size on the site (globals.css `sheet`). */
const PAPER_TILE = "600px 600px";
/** Room between the card and its name, in px. */
const GAP_PX = 64;
/** Scryfall's `large` image is 672×936. */
const CARD_ASPECT = 672 / 936;
const CARD_HEIGHT_PX = OG_IMAGE_SIZE.height - 2 * PAD_PX;
const CARD_WIDTH_PX = Math.round(CARD_HEIGHT_PX * CARD_ASPECT);
/** A printed card's corner is about 4.5% of its width. */
const CARD_RADIUS_PX = Math.round(CARD_WIDTH_PX * 0.045);
/** The walnut tile's size on the site (globals.css `background-size`), so the plate shows the same grain. */
const WALNUT_TILE = "900px 480px";

/** Name size in px: large for most names, smaller past LONG_NAME_CHARS so long ones still fit in three lines. */
const NAME_PX = 84;
const LONG_NAME_PX = 64;
const LONG_NAME_CHARS = 24;
const NAME_MAX_LINES = 3;
const MARK_PX = 36;
const RULE_WIDTH_PX = 120;
const RULE_HEIGHT_PX = 3;
const RULE_GAP_PX = 28;

/** A share crawler waits only a few seconds; a slow Scryfall answer gives the name-only plate instead. */
const IMAGE_TIMEOUT_MS = 8_000;
/** Lets the CDN keep a plate for a day and serve it stale for a week while it re-renders. */
const CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

// Static TTF and JPEG: Satori reads neither woff2, variable fonts nor webp.
const cormorantBold = readFile(join(process.cwd(), "assets/og/cormorant-garamond-700.ttf"));
const jpegDataUrl = (file: string) => readFile(join(process.cwd(), "assets/og", file), "base64").then((b) => `data:image/jpeg;base64,${b}`);
const walnut = jpegDataUrl("walnut.jpg");
const paper = jpegDataUrl("paper.jpg");

/** The card image as a data URL. Throws when Scryfall doesn't answer, so the cached plate is never the fallback. */
async function fetchCardImage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Card image ${url} answered ${res.status}`);
  const type = res.headers.get("content-type") ?? "image/jpeg";
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

async function renderPlate(name: string, image: string | null): Promise<Uint8Array> {
  const nameSize = name.length > LONG_NAME_CHARS ? LONG_NAME_PX : NAME_PX;
  const response = new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        padding: PAD_PX,
        backgroundColor: COLOURS.wood,
        backgroundImage: `radial-gradient(circle at 50% 40%, transparent 45%, ${COLOURS.vignette} 100%), url(${await walnut})`,
        backgroundSize: `100% 100%, ${WALNUT_TILE}`,
      }}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img> only
        <img
          src={image}
          alt=""
          width={CARD_WIDTH_PX}
          height={CARD_HEIGHT_PX}
          style={{ borderRadius: CARD_RADIUS_PX, boxShadow: `0 12px 32px ${COLOURS.shadow}`, marginRight: GAP_PX }}
        />
      ) : null}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          height: "100%",
          justifyContent: "center",
          padding: SHEET_PAD_PX,
          backgroundColor: COLOURS.paper,
          backgroundImage: `url(${await paper})`,
          backgroundSize: PAPER_TILE,
          boxShadow: `inset 0 0 0 1px ${COLOURS.rim}, inset 0 0 36px 4px ${COLOURS.rimGlow}, 0 12px 26px -10px ${COLOURS.shadow}`,
        }}
      >
        <div style={{ width: RULE_WIDTH_PX, height: RULE_HEIGHT_PX, backgroundColor: COLOURS.rule, marginBottom: RULE_GAP_PX }} />
        <div
          style={{
            display: "block",
            fontFamily: "Cormorant Garamond",
            fontSize: nameSize,
            lineHeight: 1.05,
            color: COLOURS.ink,
            lineClamp: NAME_MAX_LINES,
          }}
        >
          {name}
        </div>
        <div
          style={{
            position: "absolute",
            right: SHEET_PAD_PX,
            bottom: SHEET_PAD_PX / 2,
            display: "flex",
            fontFamily: "Cormorant Garamond",
            fontSize: MARK_PX,
            color: COLOURS.mark,
          }}
        >
          {SITE_NAME}
        </div>
      </div>
    </div>,
    { ...OG_IMAGE_SIZE, fonts: [{ name: "Cormorant Garamond", data: await cormorantBold, weight: 700, style: "normal" }] },
  );
  return new Uint8Array(await response.arrayBuffer());
}

/** The plate's PNG, or null for a slug with no card. Cached with the card's data (tags "catalog", `card:{slug}`). */
async function cachedPlate(slug: string): Promise<Uint8Array | null> {
  "use cache";
  cacheLife("days");
  cacheTag("catalog", `card:${slug}`);
  const page = await getCardPage(slug);
  if (!page) return null;
  // Scryfall's front image is a double-faced card's front face.
  const url = page.card.images?.front.large;
  return renderPlate(displayName(page.card), url ? await fetchCardImage(url) : null);
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let png: Uint8Array | null;
  try {
    png = await cachedPlate(slug);
  } catch (err) {
    // Scryfall didn't answer: the name alone, uncached, so the next request tries the image again.
    console.error(err);
    const page = await getCardPage(slug);
    png = page ? await renderPlate(displayName(page.card), null) : null;
  }
  if (!png) return new Response(null, { status: 404 });
  return new Response(png as Uint8Array<ArrayBuffer>, { headers: { "Content-Type": contentType, "Cache-Control": CACHE_CONTROL } });
}
