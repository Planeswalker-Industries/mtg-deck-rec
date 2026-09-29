import { cn } from "cn";

const PILL = "inline-flex h-5 items-center rounded-full px-2 text-xs font-semibold whitespace-nowrap";

export function GameChangerBadge({ className }: { className?: string }) {
  return <span className={cn(PILL, "bg-gc-bg text-gc", className)}>Game Changer</span>;
}

export function OwnedBadge({ className }: { className?: string }) {
  // A status, not an action: neutral, so the accent stays on what you can press.
  return <span className={cn(PILL, "bg-foreground/10 text-foreground", className)}>Owned</span>;
}
