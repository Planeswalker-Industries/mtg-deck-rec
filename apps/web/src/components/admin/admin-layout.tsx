"use client";

import { Box } from "@mui/material";
import { useRouter } from "next/navigation";
import { Suspense, type MouseEvent, type ReactElement } from "react";
import { AppBar, Inspector, Loading, Menu, MenuItemLink, Sidebar, SkipNavigationButton, TitlePortal, type LayoutProps } from "react-admin";
import FeedbackIcon from "@mui/icons-material/Feedback";
import LayersIcon from "@mui/icons-material/Layers";
import { ADMIN_TOKENS } from "./theme";

/**
 * React Admin's own <Layout>, rebuilt so the admin area sits inside the site rather than on top of it.
 *
 * Four things it gives no props for:
 *
 *  - It wraps its content in a <main>, and this app renders inside the site layout's <main>. Two main landmarks on
 *    one page is invalid and leaves anything asking for "the main region" with an ambiguous answer. The element is a
 *    <div> here; it keeps RaLayout's class names, so the theme's styles still apply.
 *  - Its app bar is fixed to the top of the viewport, where it covers the site header. It is `static` here and
 *    scrolls with the page, which also removes the top margin <Layout> adds to clear it.
 *  - It is 100vh tall, which on top of the site's header and footer makes a page taller than the screen with nothing
 *    in the extra space. The frame is sized to what is left instead.
 *  - Its app bar carries a user menu, which is the site header's account control a second time, twenty pixels lower.
 *    `userMenu={false}` drops it; the refresh button and the sidebar toggle stay, because nothing else offers those.
 *  - Its root is `min-width: fit-content`, which makes the whole *page* as wide as the widest table. The site clips
 *    horizontal overflow on <html> and <body> (a full-bleed hero needs it), so on a phone that put the far columns
 *    somewhere no scroll could reach and cut the site header off mid-word. The frame stays within the viewport here
 *    and the table scrolls inside its own card instead.
 */

/**
 * A link out of the single-page admin app to one of the site's own admin pages (/admin/crawls, /admin/reports), which
 * are ordinary Next routes rather than React Admin resources. MenuItemLink renders a react-router link, and
 * react-router knows nothing about those pages, so the click is handed to Next's router instead — a client
 * navigation, not a reload, since both live under /admin.
 */
const SitePageMenuItem = ({ page, label, icon }: { page: "crawls" | "reports"; label: string; icon: ReactElement }) => {
  const router = useRouter();
  return (
    <MenuItemLink
      to={`/${page}`}
      primaryText={label}
      leftIcon={icon}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        router.push(`/admin/${page}`);
      }}
    />
  );
};

/** The title and the reload control, and nothing that the site header already provides. */
const AdminAppBar = () => (
  <AppBar position="static" color="transparent" userMenu={false}>
    <TitlePortal variant="h6" />
  </AppBar>
);

export const AdminLayout = ({ children }: LayoutProps) => (
  <Box
    className="layout RaLayout-root"
    sx={{
      display: "flex",
      flexDirection: "column",
      position: "relative",
      zIndex: 1,
      width: "100%",
      minWidth: 0,
      minHeight: "70vh",
      backgroundColor: "background.default",
      // The seam under the site header, so the two do not read as one bar.
      borderTop: `1px solid ${ADMIN_TOKENS.seam}`,
    }}
  >
    <SkipNavigationButton />
    <Box className="RaLayout-appFrame" sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <AdminAppBar />
      <Box className="RaLayout-contentWithSidebar" sx={{ display: "flex", flexGrow: 1, minWidth: 0, transition: "none" }}>
        <Sidebar>
          {/*
            The crawls and reports pages are not React Admin resources — they are the site's own pages under /admin,
            because they are read rather than administered. They still belong in this menu, which is where someone goes
            looking for the admin area's parts, so they are added by hand. `to` is an absolute path: the router's
            basename is /admin, and a relative one would resolve to /admin/admin/crawls.
          */}
          <Menu>
            <Menu.ResourceItems />
            <SitePageMenuItem page="crawls" label="Deck crawls" icon={<LayersIcon />} />
            <SitePageMenuItem page="reports" label="Feedback reports" icon={<FeedbackIcon />} />
          </Menu>
        </Sidebar>
        <Box
          id="main-content"
          className="RaLayout-content"
          sx={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            minWidth: 0,
            // The site's own gutter on a phone, roomier once there is space for it.
            px: { xs: 2, sm: 3 },
            py: 3,
            gap: 2,
          }}
        >
          <Suspense fallback={<Loading />}>{children}</Suspense>
        </Box>
      </Box>
    </Box>
    <Inspector />
  </Box>
);
