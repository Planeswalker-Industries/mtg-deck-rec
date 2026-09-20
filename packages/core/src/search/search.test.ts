import { describe, expect, it } from "vitest";
import { colorsToMask, identityFilter, maskToColors, SCHEMAS, type CardDocument, type TagDocument } from "./documents";
import {
  cardRowFromDocument,
  tagRefsFromDocument,
  toCardDocument,
  toCommanderCardDocument,
  toCommanderDocument,
  toTagDocument,
  type CardIndexRow,
} from "./mappers";

const row: CardIndexRow = {
  id: 42,
  oracle_id: "3b1b2a1e-0000-4000-8000-000000000000",
  name: "Swords to Plowshares",
  name_normalized: "swords to plowshares",
  slug: "swords-to-plowshares",
  type_line: "Instant",
  mana_value: 1,
  color_identity: 1, // W
  keywords: [],
  game_changer: false,
  is_basic_land: false,
  legal_commander: "legal",
  can_be_commander: false,
  partner_kind: null,
  partner_qualifier: null,
  copy_limit: null,
  artist: "Terese Nielsen",
  images: { front: { normal: "https://cards.scryfall.io/normal/front/a.jpg" }, back: null },
  released_at: new Date("1994-06-01T00:00:00Z"),
  first_printed_at: "1993-12-01",
  reference_price_usd: "1.47",
  reference_price_finish: "nonfoil",
  prices_as_of: new Date("2026-09-18T04:00:00Z"),
  staple_score: 0.93,
  baseline_rate: 0.41,
  baseline_decks_with: 4100,
  baseline_eligible_decks: 10000,
  commander_deck_count: 0,
  names: ["swords to plowshares"],
  tag_ids: ["444f824c-f910-4530-9dbe-ede7a84cd7f9", "6ba18e8c-ca24-4c2e-86e3-304e9096074d"],
  tag_depths: [0, 1],
};

describe("colour identity", () => {
  it("round-trips a bitmask through letters", () => {
    for (let mask = 0; mask < 32; mask++) expect(colorsToMask(maskToColors(mask))).toBe(mask);
  });

  it("excludes exactly the colours a deck does not allow", () => {
    // A white-black deck: a candidate may not carry U, R or G.
    expect(identityFilter(0b00101)).toBe("colors:!=[U,R,G]");
    // Five colours exclude nothing, so the filter is dropped rather than sent as a no-op.
    expect(identityFilter(0b11111)).toBeNull();
    // Colourless deck: every colour is disallowed, and a colourless card's empty array still passes.
    expect(identityFilter(0)).toBe("colors:!=[W,U,B,R,G]");
  });
});

describe("card documents", () => {
  it("round-trips a row through a document", () => {
    const doc = toCardDocument(row, 1_700_000_000_000);
    const back = cardRowFromDocument(doc);
    expect(back).toEqual({
      id: 42,
      oracle_id: row.oracle_id,
      name: "Swords to Plowshares",
      slug: "swords-to-plowshares",
      mana_value: 1,
      type_line: "Instant",
      color_identity: 1,
      images: { front: { normal: "https://cards.scryfall.io/normal/front/a.jpg" }, back: null },
      game_changer: false,
      released_at: "1994-06-01",
      reference_price_usd: 1.47,
      reference_price_finish: "nonfoil",
      prices_as_of: "2026-09-18T04:00:00.000+00:00",
      legal_commander: "legal",
      can_be_commander: false,
      partner_kind: null,
      partner_qualifier: null,
      copy_limit: null,
      is_basic_land: false,
      artist: "Terese Nielsen",
      keywords: [],
    });
  });

  it("keys a document by the card id, so a rename cannot orphan it", () => {
    const doc = toCardDocument(row);
    expect(doc.id).toBe("42");
    expect(toCardDocument({ ...row, slug: "swords-to-plowshares-renamed" }).id).toBe(doc.id);
  });

  it("omits absent optional fields rather than sending null, which Typesense rejects", () => {
    const doc = toCardDocument({ ...row, artist: null, images: null, reference_price_usd: null, prices_as_of: null });
    expect("artist" in doc).toBe(false);
    expect("images_json" in doc).toBe(false);
    expect("reference_price_usd" in doc).toBe(false);
    expect(cardRowFromDocument(doc).artist).toBeNull();
    expect(cardRowFromDocument(doc).images).toBeNull();
  });

  it("writes timestamps the way PostgREST does, so a fallback reads identically", () => {
    // Not toISOString()'s trailing Z: the app renders and compares this string, and a card fetched from the index
    // has to equal the same card fetched from the database when the index is unavailable.
    expect(toCardDocument(row).prices_as_of).toBe("2026-09-18T04:00:00.000+00:00");
  });

  it("indexes the first word of every name, which is how 'starts with' outranks 'contains'", () => {
    const doc = toCardDocument({ ...row, names: ["swords to plowshares", "emeritus of truce // swords to plowshares"] });
    expect(doc.name_head).toEqual(["swords", "emeritus"]);
  });

  it("keeps a numeric price that arrives as a string from the driver", () => {
    expect(toCardDocument({ ...row, reference_price_usd: "0.05" }).reference_price_usd).toBe(0.05);
  });

  it("dates a card by its first printing, not by the representative printing", () => {
    // Oracle Cards dates Sol Ring by its latest printing; release-aware play rates must not believe that.
    expect(toCardDocument(row).first_printed_at).toBe("1993-12-01");
  });

  it("defaults missing stats to zero so every document has the fields the schema declares", () => {
    const doc = toCardDocument({ ...row, staple_score: null, baseline_rate: null, commander_deck_count: null });
    expect(doc.staple_score).toBe(0);
    expect(doc.baseline_rate).toBe(0);
    expect(doc.commander_deck_count).toBe(0);
  });

  it("says whether a baseline row exists, which is not the same as its counts being zero", () => {
    // No row: the reader counts eligible decks from the identity histograms rather than reading 0 as "unplayed".
    expect(toCardDocument({ ...row, baseline_rate: null }).has_baseline).toBe(false);
    // A row that happens to hold zeroes is still knowledge, and stays knowledge.
    expect(toCardDocument({ ...row, baseline_rate: 0, baseline_decks_with: 0, baseline_eligible_decks: 0 }).has_baseline).toBe(true);
  });

  it("declares every field it writes", () => {
    const declared = new Set(SCHEMAS.cards.fields.map((f) => f.name));
    const written = Object.keys(toCardDocument(row)).filter((k) => k !== "id");
    expect(written.filter((k) => !declared.has(k))).toEqual([]);
  });
});

describe("tag refs", () => {
  const tags = new Map<string, TagDocument>([
    ["444f824c-f910-4530-9dbe-ede7a84cd7f9", { id: "444f824c-f910-4530-9dbe-ede7a84cd7f9", slug: "removal", label: "Removal", idf: 0.3, disabled: false, updated_at: 0 }],
    ["6ba18e8c-ca24-4c2e-86e3-304e9096074d", { id: "6ba18e8c-ca24-4c2e-86e3-304e9096074d", slug: "swap-removal", label: "Swap removal", idf: 0.8, disabled: false, updated_at: 0 }],
  ]);
  const doc = toCardDocument(row) as CardDocument;

  it("reads labels from the tags collection, shallowest first", () => {
    expect(tagRefsFromDocument(doc, tags).map((t) => t.slug)).toEqual(["removal", "swap-removal"]);
  });

  it("applies the kill switch at read time, so disabling a tag needs no card reindex", () => {
    const killed = new Map(tags);
    killed.set("444f824c-f910-4530-9dbe-ede7a84cd7f9", { ...tags.get("444f824c-f910-4530-9dbe-ede7a84cd7f9")!, disabled: true });
    expect(tagRefsFromDocument(doc, killed).map((t) => t.slug)).toEqual(["swap-removal"]);
  });

  it("drops a tag the collection doesn't know rather than inventing a label", () => {
    expect(tagRefsFromDocument(doc, new Map())).toEqual([]);
  });
});

describe("the other collections", () => {
  it("keys a commander document by its key id and a pair by both commander ids", () => {
    const doc = toCommanderDocument({
      id: 7,
      slug: "rograkh-son-of-rohgahh--silas-renn-seeker-adept",
      commander_1: 10,
      commander_2: 20,
      color_identity: 0b01110,
      deck_count: 25,
      names: ["Rograkh, Son of Rohgahh", "Silas Renn, Seeker Adept"],
    });
    expect(doc.id).toBe("7");
    expect(doc.slug).toBe("rograkh-son-of-rohgahh--silas-renn-seeker-adept");
    expect(doc.commander_ids).toEqual([10, 20]);
    expect(doc.name).toBe("Rograkh, Son of Rohgahh // Silas Renn, Seeker Adept");
  });

  it("keys a commander-card document by the pair it is about", () => {
    const doc = toCommanderCardDocument({
      commander_key_id: 7,
      card_id: 42,
      decks_with: 120,
      inclusion_shrunk: 0.62,
      synergy: 0.21,
      color_identity: 1,
      game_changer: false,
    });
    expect(doc.id).toBe("7:42");
    expect(doc.colors).toEqual(["W"]);
  });

  it("keeps a tag document keyed by UUID, never by slug", () => {
    const doc = toTagDocument({ id: "444f824c-f910-4530-9dbe-ede7a84cd7f9", slug: "removal", label: "Removal", idf: null, disabled: false });
    expect(doc.id).toBe("444f824c-f910-4530-9dbe-ede7a84cd7f9");
    expect(doc.idf).toBe(0);
  });
});
