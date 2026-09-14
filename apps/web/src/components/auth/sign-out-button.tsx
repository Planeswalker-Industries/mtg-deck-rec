"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOutAction } from "@/app/sign-in/actions";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="lg"
        variant="outline"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const result = await signOutAction();
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
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
