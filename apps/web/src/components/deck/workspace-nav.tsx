"use client";

import { Layers, Library, UserRound } from "lucide-react";
import { cn } from "cn";
import Link from "next/link";
import { groupHeading, groupId } from "./deck-group-id";
import type { DeckGroups } from "./use-deck-groups";

const LINKS = [
  { href: "/decks", label: "My decks", Icon: Layers },
  { href: "/collection", label: "My collection", Icon: Library },
  { href: "/account", label: "Account", Icon: UserRound },
] as const;

/**
 * The workspace's left column on a wide screen: where you are in this deck, and the way out to everything else.
 *
 * It's hidden below `lg`, where the three columns become one and the header's own nav is a tap away; a phone's room
 * goes to the cards.
 */
export function WorkspaceNav({ deckGroups, showSections }: { deckGroups: DeckGroups; showSections: boolean }) {
  const { groups } = deckGroups;
  // The section links jump to group headings, so they only mean anything while the middle column is the deck.
  const sections = showSections && groups.length > 0;

  return (
    // Sticky so the sections stay reachable through a hundred cards; top clears the deck bar.
    <nav aria-label="Workspace" className="sticky top-4 flex flex-col gap-6 text-sm">
      {sections && (
        <div className="flex flex-col gap-1">
          <h2 className="px-2 pb-1 font-heading text-base leading-none font-semibold text-muted-foreground">Sections</h2>
          {/* max-h keeps a 12-group tag view from pushing the links off the screen. */}
          <ul className="flex max-h-[50vh] flex-col overflow-y-auto">
            {groups.map((group) => (
              <li key={group.key}>
                <a
                  href={`#${groupId(group)}`}
                  className="flex items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-sleeve hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span className="truncate font-bold">{groupHeading(group.label)}</span>
                  <span className="shrink-0 tabular-nums">{group.count}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className={cn("flex flex-col", sections && "border-t border-seam pt-4")}>
        {LINKS.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 font-bold text-muted-foreground transition-colors hover:bg-sleeve hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
