"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOutAction } from "@/app/sign-in/actions";
import { Button } from "@/components/ui/button";
import { ErrorText } from "@/components/ui/error-text";
import { callAction } from "@/lib/api/call-action";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        type="button"
        size="lg"
        variant="outline"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const result = await callAction(() => signOutAction());
          if (!result.ok) {
            setPending(false);
            setError(result.error.message);
            return;
          }
          router.replace("/");
          router.refresh();
        }}
      >
        {pending ? "Signing out…" : "Sign out"}
      </Button>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
