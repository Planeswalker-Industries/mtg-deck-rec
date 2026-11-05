import Link from "next/link";
import { TEXT_LINK } from "@/lib/constants";

/**
 * One row of links and the Wizards notice, kept to two lines: the data credits and the full Fan Content wording live
 * in "Credits and legal" on /privacy, which the middle link opens.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-seam text-xs text-muted-foreground">
      <div className="page-column flex flex-col gap-1.5 py-4">
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <a href="https://scryfall.com" className={TEXT_LINK}>
            Scryfall
          </a>
          <Link href="/privacy#credits" className={TEXT_LINK}>
            Credits and legal
          </Link>
          <Link href="/privacy" className={TEXT_LINK}>
            Privacy policy
          </Link>
        </p>
        <p>Unofficial Fan Content. Not approved/endorsed by Wizards. ©Wizards of the Coast LLC.</p>
      </div>
    </footer>
  );
}
