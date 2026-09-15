/** Only same-site paths: "/deck" is fine; "//evil.example", "/\\evil" and "https://..." fall back. Safe in client code. */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : fallback;
}
