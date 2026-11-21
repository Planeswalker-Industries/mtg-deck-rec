import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "cn";
import { TEXT_LINK } from "@/lib/constants";

/** Back to the React Admin app, from one of the site's own admin pages. It sits on the page's first sheet. */
export function AdminBackLink() {
  return (
    <Link href="/admin" className={cn(TEXT_LINK, "inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-semibold sm:min-h-0")}>
      <ArrowLeft aria-hidden className="size-4" />
      Admin
    </Link>
  );
}
