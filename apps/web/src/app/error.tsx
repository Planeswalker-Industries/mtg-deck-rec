"use client"; // Error boundaries must be Client Components

import { ErrorPanel } from "@/components/layout/error-panel";

// Renders inside the root layout, so the header and footer stay.
export default function ErrorPage(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorPanel {...props} />;
}
