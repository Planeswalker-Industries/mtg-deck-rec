import { cn } from "cn";

const PILL = "inline-flex h-5 items-center rounded-full px-2 text-xs font-bold whitespace-nowrap";

export function GameChangerBadge({ className }: { className?: string }) {
  return <span className={cn(PILL, "bg-gc-bg text-gc", className)}>Game Changer</span>;
}

export function OwnedBadge({ className }: { className?: string }) {
  return <span className={cn(PILL, "bg-primary/10 text-primary", className)}>Owned</span>;
}
