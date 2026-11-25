import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cacheLife, cacheTag } from "next/cache";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { OG_IMAGE_SIZE, USER_AGENT } from "@/lib/constants";
import { logError } from "./error-log";

/**
 * The share plate (T101) for card, commander and saved-deck pages: a paper sheet on the walnut table, the card's art
 * in a gilded frame on the left, the Spell Chasm wordmark on the right, the artist's credit under the art. Rendered
 * once per art and cached; a share crawler's repeat visit costs no Scryfall fetch. Satori draws a PNG; the photo textures
 * and art make that about 1.2 MB, so it is sent as a JPEG instead (about 70-100 KB, no visible change).
 */

export const PLATE_CONTENT_TYPE = "image/jpeg";
/** mozjpeg quality: 80 keeps the gilt and the wordmark's edges clean at about 70-100 KB. */
const PLATE_JPEG_QUALITY = 80;

/** Wood, paper and brass tokens from globals.css; Satori reads no CSS variables. */
const COLOURS = {
  wood: "#1c120c", // --wood: the walnut's base
  paper: "#f4e8d7", // --paper, champagne mist 100: the sheet
  brassLight: "#d2a360", // --brass-light, champagne mist 400: the gilt's highlight
  brass: "#9f702d", // --brass, champagne mist 600: the gilt
  brassDeep: "#775422", // --brass-deep, champagne mist 700: the gilt's shade, and the credit (5.6:1 on the paper)
  rim: "rgba(119, 84, 34, 0.25)", // --brass-deep at 25%: the sheet's aged edge, as the `sheet` utility draws it
  rimGlow: "rgba(159, 112, 45, 0.14)", // --brass at 14%: the sheet's inner browning
  vignette: "rgba(8, 4, 2, 0.6)", // the body's edge darkening
  shadow: "rgba(0, 0, 0, 0.55)", // the sheet's shadow on the table
  artShadow: "rgba(19, 17, 17, 0.45)", // --wood-bar at 45%: the frame's shadow on the paper, as ArtPlate draws it
  artGround: "#131111", // --wood-bar, onyx 950: behind art that doesn't fill its frame
};

/** Wood showing around the sheet, in px. */
const TABLE_PX = 36;
/** The sheet's inner margin, in px. */
const SHEET_PAD_PX = 36;
/** Room between the frame and the wordmark, in px. */
const GAP_PX = 40;
/** The gilt's width, in px, and the thin shaded line inside it. */
const GILT_PX = 10;
const GILT_INNER_PX = 2;
/** Scryfall's art crops are 626×457. */
const ART_ASPECT = 626 / 457;
/** Room under the frame for the credit line, in px. */
const CREDIT_PX = 22;
const CREDIT_GAP_PX = 8;
const FRAME_HEIGHT_PX = OG_IMAGE_SIZE.height - 2 * (TABLE_PX + SHEET_PAD_PX) - CREDIT_PX - CREDIT_GAP_PX;
const ART_HEIGHT_PX = FRAME_HEIGHT_PX - 2 * (GILT_PX + GILT_INNER_PX);
const ART_WIDTH_PX = Math.round(ART_HEIGHT_PX * ART_ASPECT);
const FRAME_WIDTH_PX = ART_WIDTH_PX + 2 * (GILT_PX + GILT_INNER_PX);
/** The stacked wordmark (assets/og/logo-ink.png) is 868×251. */
const LOGO_ASPECT = 868 / 251;
const LOGO_MAX_WIDTH_PX = 380;
/** The paper and walnut tiles' sizes on the site (globals.css), so the plate shows the same grain. */
const PAPER_TILE = "600px 600px";
const WALNUT_TILE = "900px 480px";

/** A share crawler waits only a few seconds; a slow Scryfall answer gives the plate without art instead. */
const IMAGE_TIMEOUT_MS = 8_000;
/** A card's or commander's art crop and artist almost never change, so a recrawl should be a CDN HIT, not a re-render (Fast Origin Transfer and CPU). */
export const PLATE_CACHE_CONTROL = "public, max-age=3600, s-maxage=2592000, stale-while-revalidate=604800";
/** A saved deck's lead commander can be changed, and the deck made private or deleted, so its plate keeps a one-day CDN life. */
export const DECK_PLATE_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

// Static TTF, JPEG and PNG: Satori reads neither woff2, variable fonts nor webp.
const asset = (file: string) => readFile(join(process.cwd(), "assets/og", file));
const cormorantBold = asset("cormorant-garamond-700.ttf");
const dataUrl = (file: string, type: string) => asset(file).then((b) => `data:${type};base64,${b.toString("base64")}`);
const walnut = dataUrl("walnut.jpg", "image/jpeg");
const paper = dataUrl("paper.jpg", "image/jpeg");
// The header's stacked wordmark in ink (--ink, onyx 900), for the paper.
const logo = dataUrl("logo-ink.png", "image/png");

/** The art as a data URL. Throws when Scryfall doesn't answer, so the cached plate is never the fallback. */
async function fetchArt(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "image/*" },
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Art ${url} answered ${res.status}`);
  const type = res.headers.get("content-type") ?? "image/jpeg";
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

/** The plate as JPEG bytes. */
async function renderPlate(art: string | null, artist: string | null): Promise<Uint8Array> {
  // Beside the art, the wordmark fills what's left of the sheet; alone, it sits twice as wide.
  const besideArt = OG_IMAGE_SIZE.width - 2 * (TABLE_PX + SHEET_PAD_PX) - FRAME_WIDTH_PX - GAP_PX;
  const logoWidth = art ? Math.min(LOGO_MAX_WIDTH_PX, besideArt) : 2 * LOGO_MAX_WIDTH_PX;
  const response = new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        padding: TABLE_PX,
        backgroundColor: COLOURS.wood,
        backgroundImage: `radial-gradient(circle at 50% 40%, transparent 45%, ${COLOURS.vignette} 100%), url(${await walnut})`,
        backgroundSize: `100% 100%, ${WALNUT_TILE}`,
      }}
    >
      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          padding: SHEET_PAD_PX,
          backgroundColor: COLOURS.paper,
          backgroundImage: `url(${await paper})`,
          backgroundSize: PAPER_TILE,
          boxShadow: `inset 0 0 0 1px ${COLOURS.rim}, inset 0 0 36px 4px ${COLOURS.rimGlow}, 0 12px 26px -10px ${COLOURS.shadow}`,
        }}
      >
        {art ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginRight: GAP_PX }}>
            {/* The gilt: a brass gradient lit from the top left, a shaded line inside it, the art in that. */}
            <div
              style={{
                display: "flex",
                padding: GILT_PX,
                backgroundImage: `linear-gradient(135deg, ${COLOURS.brassLight} 0%, ${COLOURS.brass} 35%, ${COLOURS.brassDeep} 55%, ${COLOURS.brass} 75%, ${COLOURS.brassLight} 100%)`,
                boxShadow: `0 6px 16px -4px ${COLOURS.artShadow}`,
              }}
            >
              <div style={{ display: "flex", padding: GILT_INNER_PX, backgroundColor: COLOURS.brassDeep }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img> only */}
                <img
                  src={art}
                  alt=""
                  width={ART_WIDTH_PX}
                  height={ART_HEIGHT_PX}
                  style={{ objectFit: "cover", backgroundColor: COLOURS.artGround }}
                />
              </div>
            </div>
            <div
              style={{
                display: "flex",
                height: CREDIT_PX,
                marginTop: CREDIT_GAP_PX,
                fontFamily: "Cormorant Garamond",
                fontSize: CREDIT_PX,
                lineHeight: 1,
                color: COLOURS.brassDeep,
              }}
            >
              {artist ? `Art by ${artist}` : ""}
            </div>
          </div>
        ) : null}
        <div style={{ display: "flex", flex: 1, justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img> only */}
          <img src={await logo} alt="" width={logoWidth} height={Math.round(logoWidth / LOGO_ASPECT)} />
        </div>
      </div>
    </div>,
    { ...OG_IMAGE_SIZE, fonts: [{ name: "Cormorant Garamond", data: await cormorantBold, weight: 700, style: "normal" }] },
  );
  const png = Buffer.from(await response.arrayBuffer());
  return new Uint8Array(await sharp(png).jpeg({ quality: PLATE_JPEG_QUALITY, mozjpeg: true }).toBuffer());
}

/** One art's plate, cached by its Scryfall URL and artist (tag "catalog"). */
async function cachedPlate(artUrl: string, artist: string | null): Promise<Uint8Array> {
  "use cache";
  cacheLife("days");
  cacheTag("catalog");
  return renderPlate(await fetchArt(artUrl), artist);
}

/**
 * The plate as a response. No art (Scryfall has no crop) gives the sheet with the wordmark alone; Scryfall not
 * answering gives the same, uncached, so the next request tries the art again.
 */
export async function plateResponse(
  artUrl: string | null | undefined,
  artist: string | null,
  cacheControl: string = PLATE_CACHE_CONTROL,
): Promise<Response> {
  let plate: Uint8Array;
  if (!artUrl) plate = await renderPlate(null, null);
  else {
    try {
      plate = await cachedPlate(artUrl, artist);
    } catch (err) {
      logError({ area: "sharePlate.render", error: err, level: "warning", context: { artUrl } });
      plate = await renderPlate(null, null);
    }
  }
  return new Response(plate as Uint8Array<ArrayBuffer>, {
    headers: { "Content-Type": PLATE_CONTENT_TYPE, "Cache-Control": cacheControl },
  });
}
