"use client";

import { Dialog } from "radix-ui";
import { Button } from "@/components/ui/button";

/**
 * Asked when the tool opens on the deck from the player's last visit: carry on with it (Yes analyzes it) or start a new
 * one (No clears it). Dismissing it leaves the deck in the decklist box, unanalyzed, as before there was a question.
 */
export function ResumeDeckDialog({
  name,
  onYes,
  onNo,
  onDismiss,
}: {
  /** The deck's name, or its commanders'; null for a deck remembered before either was kept. */
  name: string | null;
  onYes: () => void;
  onNo: () => void;
  onDismiss: () => void;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onDismiss()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-seam bg-popover p-5 text-popover-foreground shadow-lg data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
          <div className="flex flex-col gap-1.5">
            <Dialog.Title className="font-heading text-xl leading-tight font-semibold tracking-tight text-balance">
              Continue with {name ?? "your last deck"}?
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              Your last decklist is still here. Pick up where you left off, or start a new deck.
            </Dialog.Description>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="lg" className="flex-1" autoFocus onClick={onYes}>
              Yes
            </Button>
            <Button type="button" size="lg" variant="outline" className="flex-1" onClick={onNo}>
              No
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
