import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "cn";

/**
 * A one-line error under a control: red, with an icon, so it never relies on colour alone. Errors that need a heading
 * use `Alert variant="destructive"` instead.
 */
export function ErrorText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn("flex items-start gap-1.5 text-sm text-destructive", className)}>
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
