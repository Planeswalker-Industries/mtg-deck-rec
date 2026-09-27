"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Search, X } from "lucide-react";
import type { CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { ColorIdentity } from "@/components/deck/color-identity";
import { getApis } from "@/lib/api/client";

/** Wait this long after the last keystroke before searching. */
const SEARCH_DELAY_MS = 180;
const MIN_QUERY = 2;
const LIMIT = 8;

/**
 * Finds any card by name from the header. Every result goes to its card page, which links on to the
 * commander page when the card has one, so a card without a commander key can't send anyone to a 404.
 *
 * The header is already full at 390px, so phones get a button that opens a full-screen layer and
 * larger screens get the input inline.
 */
export function SiteSearch() {
  const [openOnPhone, setOpenOnPhone] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpenOnPhone(true)}
        aria-label="Search cards"
        className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:hidden"
      >
        <Search aria-hidden className="size-5" />
      </button>

      <div className="hidden sm:block sm:w-56 lg:w-72">
        <SearchField />
      </div>

      {openOnPhone && <PhoneSearchLayer onClose={() => setOpenOnPhone(false)} />}
    </>
  );
}

function PhoneSearchLayer({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Search cards" className="fixed inset-0 z-50 bg-background sm:hidden">
      <div className="flex items-center gap-2 border-b border-seam p-3">
        <div className="min-w-0 flex-1">
          <SearchField autoFocus onPicked={onClose} />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>
    </div>
  );
}

function SearchField({ autoFocus = false, onPicked }: { autoFocus?: boolean; onPicked?: () => void }) {
  const id = useId();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CardSummary[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const request = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  /** The call in flight, so a newer search can stop it competing for the connection with the one that matters. */
  const inFlight = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      inFlight.current?.abort();
    },
    [],
  );

  function search(value: string) {
    setQuery(value);
    window.clearTimeout(timer.current);
    // The counter is what keeps a slow earlier response from overwriting a newer one; the abort is what stops that
    // response ever arriving. Both are needed: a discarded answer still cost the round trip it was queued behind.
    const current = ++request.current;
    inFlight.current?.abort();
    inFlight.current = null;
    const q = value.trim();
    if (q.length < MIN_QUERY) {
      setResults([]);
      setStatus("idle");
      return;
    }
    setStatus("searching");
    timer.current = window.setTimeout(() => {
      const controller = new AbortController();
      inFlight.current = controller;
      void getApis()
        .catalog.searchCards({ q, commanderEligible: false, limit: LIMIT }, { signal: controller.signal })
        .then((r) => {
          if (current !== request.current) return;
          inFlight.current = null;
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

  const pick = useCallback(
    (card: CardSummary) => {
      setResults([]);
      setQuery("");
      onPicked?.();
      router.push(`/card/${card.slug}`);
    },
    [onPicked, router],
  );

  const listId = `${id}-results`;
  const open = results.length > 0 && focused;
  const hint =
    status === "searching"
      ? "Searching…"
      : status === "error"
        ? error
        : query.trim().length >= MIN_QUERY && results.length === 0
          ? "No cards match that name."
          : "";

  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        id={`${id}-input`}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        aria-label="Search cards and commanders"
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => search(e.target.value)}
        onFocus={() => setFocused(true)}
        // Let a click on a result land before the list closes.
        onBlur={() => window.setTimeout(() => setFocused(false), 150)}
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
            const chosen = results[active];
            if (chosen) pick(chosen);
          }
        }}
        placeholder="Search cards"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="h-9 w-full rounded-md border border-seam bg-background pl-9 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      />
      {hint && (
        <p
          aria-live="polite"
          className="absolute top-full right-0 left-0 z-50 mt-1 rounded-lg border border-seam bg-sleeve px-3 py-2 text-sm text-muted-foreground"
        >
          {hint}
        </p>
      )}
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute top-full right-0 left-0 z-50 mt-1 flex max-h-[70vh] flex-col divide-y divide-seam overflow-y-auto rounded-lg border border-seam bg-sleeve shadow-lg sm:max-h-96"
        >
          {results.map((card, i) => {
            // The card's `small` printing, not `artCrop`: this box is 56x36, and the art crop is a 626x457 JPEG at
            // ~72 KB against `small`'s ~13 KB, so eight results cost half a megabyte for thumbnails. Cropped to the
            // art band — a card scaled to this width puts its art between roughly 10% and 57% of its height, and
            // 20% from the top centres that band in the window.
            const art = card.images?.front.small;
            return (
              <li
                key={card.id}
                id={`${id}-option-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(card)}
                onMouseEnter={() => setActive(i)}
                className={cn("flex cursor-pointer items-center gap-3 px-3 py-2", i === active && "bg-primary/10")}
              >
                {art ? (
                  <Image
                    src={art}
                    alt=""
                    width={146}
                    height={204}
                    unoptimized
                    className="h-9 w-14 shrink-0 rounded-md object-cover object-[50%_20%] ring-1 ring-seam"
                  />
                ) : (
                  <span aria-hidden className="h-9 w-14 shrink-0 rounded-md bg-seam" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{card.name}</span>
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
