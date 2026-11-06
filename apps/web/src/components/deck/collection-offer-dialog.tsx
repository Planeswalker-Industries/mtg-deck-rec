"use client";

import Link from "next/link";
import type { Route } from "next";
import { Dialog } from "radix-ui";
import { Button } from "@/components/ui/button";

/**
 * Offered on every visit to a player with no collection, signed in or not, on the deck tool's opening screens: tell us
 * what you own and the suggestions come from your shelf first. Dismissing it leaves the page as it was for this visit;
 * the import links in the page say the same thing until the next one.
 */
export function CollectionOfferDialog({ importHref, onDismiss }: { importHref: Route; onDismiss: () => void }) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onDismiss()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-seam bg-popover p-5 text-popover-foreground shadow-lg data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
          <div className="flex flex-col gap-1.5">
            <Dialog.Title className="font-heading text-xl leading-tight font-semibold tracking-tight text-balance">
              Hold up — got cards already?
            </Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">
              Tell us what&apos;s in your binder and we&apos;ll build from your shelf first, so the upgrades cost you
              nothing. Import takes a file or a pasted list.
            </Dialog.Description>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="lg" className="flex-1" autoFocus asChild>
              <Link href={importHref} onClick={onDismiss}>
                Add collection
              </Link>
            </Button>
            <Button type="button" size="lg" variant="outline" className="flex-1" onClick={onDismiss}>
              Continue
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
