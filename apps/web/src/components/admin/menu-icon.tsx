"use client";

import type { LucideIcon } from "lucide-react";

/**
 * A menu icon from the site's own set (lucide), sized like the rest of the menu's text. Each screen gets an icon that
 * says what it holds, rather than Material's default list glyph on every one.
 */
export function MenuIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon aria-hidden className="size-5" />;
}

/** The same icon as a component, which is what a React Admin <Resource icon> takes. */
export const menuIcon = (icon: LucideIcon) => {
  const ResourceIcon = () => <MenuIcon icon={icon} />;
  ResourceIcon.displayName = `MenuIcon(${icon.displayName ?? "icon"})`;
  return ResourceIcon;
};
