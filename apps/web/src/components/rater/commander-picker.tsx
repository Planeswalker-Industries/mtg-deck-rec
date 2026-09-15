"use client";

import { useId, useRef, useState } from "react";
import Image from "next/image";
import type { CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { ColorIdentity } from "@/components/deck/color-identity";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApis } from "@/lib/api/client";
import { displayName } from "@/lib/cards";

/** Wait this long after the last keystroke before searching. */
const SEARCH_DELAY_MS = 180;

/** Finds a commander by name as the player types: a combobox with arrow keys and Enter, each result shown with its art. */
export function CommanderPicker({ onPick }: { onPick: (card: CardSummary) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardSummary[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const request = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  function search(value: string) {
    setQuery(value);
    window.clearTimeout(timer.current);
    const current = ++request.current;
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }
    setStatus("searching");
    timer.current = window.setTimeout(() => {
      void getApis()
        .catalog.searchCards({ q, commanderEligible: true, limit: 8 })
        .then((r) => {
          if (current !== request.current) return;
          if (r.ok) {
            setResults(r.data);
            setActive(0);
            setStatus("idle");
          } else {
            setResults([]);
            setError(r.error.message);
            setStatus("error");
          }
        });
    }, SEARCH_DELAY_MS);
  }

  const listId = `${id}-results`;
  const open = results.length > 0;
  const hint =
    status === "searching"
      ? "Searching…"
      : status === "error"
        ? error
        : query.trim().length >= 2 && results.length === 0
          ? "No commanders match that name."
          : "";

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${id}-input`} className="text-base font-bold">
        Commander
      </Label>
      <Input
        id={`${id}-input`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        value={query}
        onChange={(e) => search(e.target.value)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % results.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a - 1 + results.length) % results.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            const pick = results[active];
            if (pick) onPick(pick);
          }
        }}
        placeholder="Liesa, Forgotten Archangel"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="h-11 bg-sleeve text-base"
      />
      <p aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {hint}
      </p>
      {open && (
        <ul id={listId} role="listbox" aria-label="Commanders" className="flex flex-col divide-y divide-seam overflow-hidden rounded-lg border border-seam bg-sleeve">
          {results.map((card, i) => {
            const art = card.images?.front.artCrop;
            return (
              <li
                key={card.id}
                id={`${id}-option-${i}`}
                role="option"
                aria-selected={i === active}
                onClick={() => onPick(card)}
                onMouseEnter={() => setActive(i)}
                className={cn("flex cursor-pointer items-center gap-3 px-3 py-2", i === active && "bg-primary/10")}
              >
                {art ? (
                  <Image src={art} alt="" width={64} height={46} unoptimized className="h-11 w-16 shrink-0 rounded-md object-cover ring-1 ring-seam" />
                ) : (
                  <span aria-hidden className="h-11 w-16 shrink-0 rounded-md bg-seam" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{displayName(card)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{card.typeLine}</span>
                </span>
                <ColorIdentity identity={card.colorIdentity} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
