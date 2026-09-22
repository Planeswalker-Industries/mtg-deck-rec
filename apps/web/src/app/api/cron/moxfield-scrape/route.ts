/**
 * The daily Moxfield crawl trigger. See lib/server/crawl-cron.ts for what this route does and why it is safe.
 * Moxfield is built but blocked (Cloudflare WAF); firing it is harmless - the crawl self-disables on first contact.
 */
import { handleCrawlCron } from "@/lib/server/crawl-cron";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleCrawlCron(request, "moxfield");
}