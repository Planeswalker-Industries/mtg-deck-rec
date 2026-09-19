"use client";

import dynamic from "next/dynamic";
import type { AdminAppProps } from "./admin-app";

/**
 * React Admin mounts react-router's BrowserRouter, which needs a window, so the app is loaded in the browser only.
 * `ssr: false` is a client-component-only option, which is why this wrapper exists at all.
 */
const AdminApp = dynamic(() => import("./admin-app"), {
  ssr: false,
  loading: () => (
    <p role="status" className="p-6 text-sm text-muted-foreground">
      Loading the admin area…
    </p>
  ),
});

export function AdminShell(props: AdminAppProps) {
  return <AdminApp {...props} />;
}
