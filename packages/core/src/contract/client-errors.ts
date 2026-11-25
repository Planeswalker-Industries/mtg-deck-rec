/**
 * A failure in a visitor's browser, sent so it opens an error ticket for the site's admins (v41). The server adds
 * what the browser can't vouch for: the time, the account from the session, the user agent and the deployment.
 */
export interface ClientErrorReport {
  /** What was running, as a dotted name: 'window.error', 'boundary.render', 'collection.import'. */
  area: string;
  /** What went wrong, as the error said it. */
  message: string;
  /** The site path it happened on: no origin, no query string (a deck tool's state never rides along). */
  pagePath: string;
  /** The error's class, such as TypeError. */
  name?: string;
  stack?: string;
  /** The API error code the page was shown, when the failure was a call's answer. */
  code?: string;
  /** A few facts about what the code was doing: sizes, steps, ids. Never what the player typed or pasted. */
  context?: Record<string, string | number | boolean | null>;
}
