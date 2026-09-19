"use client";

import { Box } from "@mui/material";
import { Suspense } from "react";
import { AppBar, Inspector, Loading, Menu, Sidebar, SkipNavigationButton, type LayoutProps } from "react-admin";

/**
 * React Admin's own <Layout>, with two changes it gives no props for.
 *
 * It wraps its content in a <main>, and this app is rendered inside the site layout's <main> — two main landmarks on
 * one page, which is invalid and leaves anything asking for "the main region" with an ambiguous answer. The element
 * is a <div> here instead; it keeps RaLayout's class names, so the theme's styles still apply.
 *
 * Its app bar is fixed to the top of the viewport, where it covers the site's own header — so it is `static` here
 * and scrolls with the page like everything else. That also removes the top margin <Layout> adds to clear it.
 *
 * It is also 100vh tall, which on top of the site's header and footer makes a page taller than the screen with
 * nothing in the extra space. The frame is sized to what is left instead.
 */
export const AdminLayout = ({ children }: LayoutProps) => (
  <Box
    className="layout RaLayout-root"
    sx={{
      display: "flex",
      flexDirection: "column",
      position: "relative",
      zIndex: 1,
      width: "100%",
      minWidth: "fit-content",
      minHeight: "70vh",
      backgroundColor: "background.default",
    }}
  >
    <SkipNavigationButton />
    <Box className="RaLayout-appFrame" sx={{ display: "flex", flexDirection: "column", flexGrow: 1 }}>
      <AppBar position="static" />
      <Box className="RaLayout-contentWithSidebar" sx={{ display: "flex", flexGrow: 1, transition: "none" }}>
        <Sidebar>
          <Menu />
        </Sidebar>
        <Box id="main-content" className="RaLayout-content" sx={{ display: "flex", flexDirection: "column", flexGrow: 1, p: 3, minWidth: 0 }}>
          <Suspense fallback={<Loading />}>{children}</Suspense>
        </Box>
      </Box>
    </Box>
    <Inspector />
  </Box>
);
