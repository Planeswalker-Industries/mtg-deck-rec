"use client";

import Link from "next/link";
import type { Route } from "next";
import { cn } from "cn";
import { Check, CircleDot, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OpenDeck } from "@/components/deck/use-deck-tool";
import { TEXT_LINK } from "@/lib/constants";
import { ErrorText } from "@/components/ui/error-text";

const STATUS: Record<OpenDeck["status"], string> = {
  saved: "Saved",
  saving: "Saving…",
  dirty: "Unsaved changes",
  error: "Couldn't save",
};

const STATUS_ICON: Record<OpenDeck["status"], LucideIcon> = {
  saved: Check,
  saving: LoaderCircle,
  dirty: CircleDot,
  error: TriangleAlert,
};

/**
 * Which saved deck the tool is editing, and whether the last change reached the account, as its own sheet. Shown only
 * while the deck bar isn't on screen (the decklist loading, a build, a held round); with the bar, `OpenDeckMenu` says
 * the same inside it.
 *
 * Editing an open deck writes back on its own, so the only thing left to say is whether it worked. A failure names
 * itself rather than passing quietly, because the player would otherwise keep editing a deck that stopped saving.
 */
export function OpenDeckBar({ deck, onClose }: { deck: OpenDeck; onClose: () => void }) {
  return (
    <section aria-label="Saved deck" className="sheet flex flex-wrap items-center gap-x-3 gap-y-2 p-4 max-sm:-mx-4 sm:p-5">
      <div className="min-w-0">
        <p className="truncate font-heading text-xl leading-none font-semibold">{deck.name}</p>
        {deck.status === "error" ? (
          <ErrorText className="mt-1">{deck.message ?? STATUS.error}</ErrorText>
        ) : (
          <p role="status" className="mt-1 text-sm text-muted-foreground">
            {STATUS[deck.status]}
          </p>
        )}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Link href={`/decks/deck/${deck.code}` as Route} className={cn(TEXT_LINK, "rounded-md px-1 py-2 text-sm font-semibold")}>
          Deck page
        </Link>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Close deck
        </Button>
      </div>
    </section>
  );
}

/**
 * The open deck's save status inside the deck bar (wood), beside its name: an icon button that names the status and
 * opens Deck page and Close deck. The bar already shows the name, so this takes no line of its own on a phone.
 */
export function OpenDeckMenu({ deck, onClose }: { deck: OpenDeck; onClose: () => void }) {
  const Icon = STATUS_ICON[deck.status];
  const label = STATUS[deck.status];
  return (
    <DropdownMenu>
      {/* Read out as it changes; the button's name says it on demand. */}
      <span role="status" className="sr-only">
        {label}
      </span>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={`Saved deck: ${label}`} title={label} className="shrink-0">
          <Icon aria-hidden className={cn("size-4", deck.status === "saving" && "animate-spin")} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuLabel className="flex items-center gap-2 text-muted-foreground">
          <Icon aria-hidden className="size-4" />
          {label}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="text-primary focus:text-primary">
          <Link href={`/decks/deck/${deck.code}` as Route}>Deck page</Link>
        </DropdownMenuItem>
        <DropdownMenuItem className="text-primary focus:text-primary" onSelect={onClose}>
          Close deck
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A failed save, under the deck bar's two lines: on paper, since red on the wood bar fails contrast. */
export function OpenDeckError({ deck }: { deck: OpenDeck }) {
  if (deck.status !== "error") return null;
  return (
    <div className="paper col-span-2 my-1 rounded-sm bg-sleeve px-2 py-1">
      <ErrorText className="text-xs">{deck.message ?? STATUS.error}</ErrorText>
    </div>
  );
}
