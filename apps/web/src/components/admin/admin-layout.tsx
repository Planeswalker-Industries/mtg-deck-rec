"use client";

import { Box } from "@mui/material";
import { Suspense } from "react";
import { AppBar, Inspector, Loading, Menu, Sidebar, SkipNavigationButton, TitlePortal, type LayoutProps } from "react-admin";
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
          <Menu />
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
