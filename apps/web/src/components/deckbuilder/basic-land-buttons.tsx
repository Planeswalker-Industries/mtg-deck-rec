"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { MANA_SYMBOL_URL } from "@/components/deck/color-identity";
import { getApis } from "@/lib/api/client";
import { PHONE_HIT_AREA } from "@/lib/constants";

/** The basic land each colour makes; a colourless commander's is Wastes. */
const BASIC_LANDS: Record<string, string> = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest", C: "Wastes" };
/** Enough results for the basic to come back beside its snow-covered and other same-named cousins. */
const LOOKUP_LIMIT = 5;
/** Intrinsic size of the mana symbol inside the button. */
const SYMBOL_PX = 20;

/** Each basic land looked up once per page, whichever deck asks: they never change. */
const lookups = new Map<string, Promise<CardSummary | null>>();

function basicLand(name: string): Promise<CardSummary | null> {
  let lookup = lookups.get(name);
  if (!lookup) {
    lookup = getApis()
      .catalog.searchCards({ q: name, cardTypes: ["land"], limit: LOOKUP_LIMIT })
      .then((r) => (r.ok ? (r.data.find((card) => card.name === name) ?? null) : null));
    // A failed lookup is forgotten, so the next deck tries again rather than going without the button.
    void lookup.then((card) => card ?? lookups.delete(name));
    lookups.set(name, lookup);
  }
  return lookup;
}

/**
 * One button per colour of the commander's identity, each adding a copy of that colour's basic land, for a player
 * typing their list in who shouldn't have to scroll to the lands for every Forest. Nothing shows before there is a
 * commander.
 */
export function BasicLandButtons({ identity, onAdd }: { identity: string | undefined; onAdd: (card: CardSummary) => void }) {
  const [lands, setLands] = useState<CardSummary[]>([]);
  const colors = identity === undefined ? [] : identity === "" ? ["C"] : [...identity];
  const key = colors.join("");

  useEffect(() => {
    let current = true;
    void Promise.all(key.split("").filter(Boolean).map((color) => basicLand(BASIC_LANDS[color] ?? ""))).then((found) => {
      if (current) setLands(found.filter((card): card is CardSummary => card !== null));
    });
    return () => {
      current = false;
    };
  }, [key]);

  if (lands.length === 0) return null;
  return (
    <div role="group" aria-label="Add a basic land" className="ml-auto flex items-center gap-1">
      {lands.map((land) => {
        const color = Object.keys(BASIC_LANDS).find((c) => BASIC_LANDS[c] === land.name) ?? "C";
        return (
          <button
            key={land.id}
            type="button"
            aria-label={`Add a ${land.name}`}
            title={`Add a ${land.name}`}
            onClick={() => onAdd(land)}
            className={cn(
              PHONE_HIT_AREA,
              "flex size-8 items-center justify-center rounded-full border border-seam transition-[border-color,transform] duration-180 ease-table",
              "hover:border-primary active:translate-y-px",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            )}
          >
            <Image src={MANA_SYMBOL_URL(color)} alt="" width={SYMBOL_PX} height={SYMBOL_PX} unoptimized className="size-5" />
          </button>
        );
      })}
    </div>
  );
}
