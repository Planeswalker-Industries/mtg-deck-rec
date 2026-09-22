/**
 * The daily Archidekt crawl trigger. See lib/server/crawl-cron.ts for what this route does and why it is safe.
 * This is the active deck source (Moxfield is blocked); it scrapes Archidekt's public API on the search API VPS.
 */
import { handleCrawlCron } from "@/lib/server/crawl-cron";

export async function GET(request: Request): Promise<Response> {
  return handleCrawlCron(request, "archidekt");
}