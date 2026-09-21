"use client";

import { Admin, Resource } from "react-admin";
import { BrowserRouter } from "react-router-dom";
import { AdminLayout } from "./admin-layout";
import { adminTheme } from "./theme";
import { createAdminAuthProvider } from "./auth-provider";
import { adminDataProvider } from "./data-provider";
import { SyncRunList, SyncRunShow } from "./sync-runs";
import { TagEdit, TagList } from "./tags";
import { PlatformAdminList, UserEdit, UserList, UserShow } from "./users";

/**
 * The admin single-page app.
 *
 * It is Material UI in a site that is otherwise shadcn and Tailwind, but it is not a different-looking product:
 * `theme.ts` restates the site's own tokens — the table, the sleeve, the seam, the gold lamp, Fraunces and Atkinson
 * Hyperlegible — as a Material UI theme, so the components React Admin brings are dressed in them. No light theme is
 * offered, like the rest of the site.
 *
 * The <BrowserRouter> is load-bearing, not decoration. Left to itself React Admin builds a *hash* router, where
 * `basename` has nothing to apply to and every screen resolves to nothing at all — /admin renders an empty page. It
 * only skips building one when it finds a router already in context, so providing the browser router here is what
 * gives the admin area real paths (/admin/users/<id>), which the catch-all route and the proxy's 404 both expect.
 *
 * The basename goes on the router and nowhere else. <Admin basename> is for the case where React Admin is *not*
 * given a router; passing both prefixes every link twice (/admin/admin/users).
 */

export interface AdminAppProps {
  userId: string;
  email: string | null;
}

export default function AdminApp({ userId, email }: AdminAppProps) {
  return (
    <BrowserRouter basename="/admin">
      <Admin
        title="MTG Deck Rec admin"
        dataProvider={adminDataProvider}
        authProvider={createAdminAuthProvider({ id: userId, fullName: email ?? undefined })}
        layout={AdminLayout}
        theme={adminTheme}
        darkTheme={null}
        disableTelemetry
      >
        <Resource
          name="users"
          list={UserList}
          show={UserShow}
          edit={UserEdit}
          recordRepresentation={(record) => record.email ?? record.displayName ?? record.id}
          options={{ label: "Users" }}
        />
        {/* The same records, filtered to the people who can reach this area. Read-only: granting and revoking is an
            edit to the user, so there is one place where it happens. */}
        <Resource name="platform-admins" list={PlatformAdminList} options={{ label: "Platform admins" }} />
        {/* The kill switch for Tagger tags: switching one off takes it out of recommendations. */}
        <Resource
          name="tags"
          list={TagList}
          edit={TagEdit}
          recordRepresentation={(record) => record.label ?? record.id}
          options={{ label: "Tags" }}
        />
        {/* The worker's run history, read-only. */}
        <Resource name="sync-runs" list={SyncRunList} show={SyncRunShow} options={{ label: "Sync runs" }} />
      </Admin>
    </BrowserRouter>
  );
}
