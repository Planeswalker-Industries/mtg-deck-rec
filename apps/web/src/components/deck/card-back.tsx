import { cn } from "cn";

/**
 * A sleeved card seen from the back: a binder-blue sleeve with a white inner border and a faint weave. Drawn in CSS, so
 * no card back art is used.
 */
export function CardBack({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "aspect-[488/680] w-full rounded-[4.75%/3.4%] bg-primary p-[7%] shadow-[0_1px_0_color-mix(in_oklch,var(--primary),black_40%)]",
        className,
      )}
    >
      <div className="size-full rounded-[3%/2.2%] border-2 border-white/70 bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.12)_0_5px,transparent_5px_11px)]" />
    </div>
  );
}
