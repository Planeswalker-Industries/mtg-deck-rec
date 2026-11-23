"use client";

import { useRef, useState } from "react";
import { Popover } from "radix-ui";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { TIP_HOVER_DELAY_MS } from "@/lib/constants";

/**
 * A button for something not built yet: drawn disabled, and it does nothing. A tap, a click or a resting mouse opens
 * "Coming soon", as a Deck stats chip opens its tip. It is `aria-disabled` rather than `disabled`, because a disabled
 * button takes no pointer events and so could never say why it is off.
 */
export function ComingSoonButton({ label, className }: { label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        type="button"
        aria-disabled="true"
        onPointerEnter={(e) => {
          if (e.pointerType !== "mouse") return;
          clear();
          timer.current = window.setTimeout(() => setOpen(true), TIP_HOVER_DELAY_MS);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "mouse") return;
          clear();
          setOpen(false);
        }}
        className={cn(buttonVariants({ variant: "outline", size: "lg" }), "cursor-not-allowed opacity-50 active:translate-y-0", className)}
      >
        {label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={6}
          collisionPadding={16}
          // A hover tip leaves focus where it was.
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-50 max-w-64 rounded-lg border border-seam bg-sleeve px-3 py-2 text-sm font-semibold tracking-wide text-foreground uppercase shadow-lift"
        >
          Coming soon
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
