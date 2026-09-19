/**
 * Every path under /admin. React Admin routes on the client with real paths (/admin/users/<id>), so a full page load
 * or a shared link on any of them has to be served by Next — the same shell as /admin, which then routes to the
 * screen the path asks for.
 *
 * It is a separate file from the parent rather than one optional catch-all because typed routes derive their literals
 * from the folder: `[[...slug]]` alone makes `/admin` itself something no <Link> can be typed against.
 */
export { default, metadata } from "../page";
