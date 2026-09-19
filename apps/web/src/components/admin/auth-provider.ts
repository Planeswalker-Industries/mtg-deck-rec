"use client";

import type { AuthProvider, UserIdentity } from "react-admin";

/**
 * React Admin's idea of authentication, wired to the site's.
 *
 * Signing in happens on /sign-in like everywhere else, and the server has already refused anyone who shouldn't be
 * here before this bundle loads — so `checkAuth` has nothing left to decide. What this provider is really for is
 * `checkError`: a session that expires while the tab is open should send the admin back to sign in rather than
 * leaving every list stuck on "not found".
 */
export function createAdminAuthProvider(identity: UserIdentity): AuthProvider {
  return {
    async login() {},
    async logout() {},
    async checkAuth() {},
    async getIdentity() {
      return identity;
    },
    async getPermissions() {
      return "admin";
    },
    async checkError(error: { status?: number }) {
      // 401: the session went. 404: access was revoked while the tab was open — the API answers as if the area
      // doesn't exist, so there is nothing useful left to show either way.
      if (error?.status === 401) {
        // A full page load on purpose, not a router push: this leaves React Admin's own client router (which is
        // mounted under basename="/admin") for a page the Next app owns, and the fresh load re-runs the proxy's
        // access check on the way in.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/sign-in?next=/admin");
        throw new Error("Signed out.");
      }
    },
  };
}
