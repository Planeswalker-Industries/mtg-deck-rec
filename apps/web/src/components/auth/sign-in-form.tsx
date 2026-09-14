"use client";

import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { sendSignInEmailAction, startGoogleSignInAction, verifySignInCodeAction } from "@/app/sign-in/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeNextPath } from "@/lib/safe-path";

const RETURN_ERRORS: Record<string, string> = {
  link: "That sign-in link didn't work or has expired. Send yourself a new code.",
  google: "Google sign-in didn't finish. Try again, or use your email.",
};

export function SignInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(RETURN_ERRORS[params.get("error") ?? ""] ?? null);

  async function sendCode() {
    setPending(true);
    setError(null);
    const result = await sendSignInEmailAction({ email, next });
    setPending(false);
    if (!result.ok) return setError(result.error.message);
    setCode("");
    setStep("code");
  }

  async function verifyCode() {
    setPending(true);
    setError(null);
    const result = await verifySignInCodeAction({ email, code });
    if (!result.ok) {
      setPending(false);
      return setError(result.error.message);
    }
    // safeNextPath only returns same-site paths, but they come from the URL, so typed routes can't know them.
    router.replace(next as Route);
    router.refresh();
  }

  async function continueWithGoogle() {
    setPending(true);
    setError(null);
    const result = await startGoogleSignInAction({ next });
    if (!result.ok) {
      setPending(false);
      return setError(result.error.message);
    }
    window.location.assign(result.data.url);
  }

  const errorAlert = error && (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );

  if (step === "code") {
    return (
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void verifyCode();
        }}
      >
        <p>
          We sent a 6-digit code to <span className="font-bold">{email}</span>. Enter it below, or open the link in that email on any
          device.
        </p>
        <Label htmlFor="sign-in-code" className="font-bold">
          Code
        </Label>
        <Input
          id="sign-in-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="bg-sleeve text-2xl tracking-[0.3em] tabular-nums sm:text-2xl"
          autoFocus
        />
        {errorAlert}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" disabled={pending || code.length !== 6}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          <Button type="button" size="lg" variant="ghost" disabled={pending} onClick={() => void sendCode()}>
            Send a new code
          </Button>
        </div>
        <button
          type="button"
          className="self-start text-sm font-bold text-primary underline-offset-4 hover:underline"
          onClick={() => {
            setStep("email");
            setError(null);
          }}
        >
          Use a different email
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void sendCode();
        }}
      >
        <Label htmlFor="sign-in-email" className="font-bold">
          Email
        </Label>
        <Input
          id="sign-in-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="bg-sleeve"
          required
        />
        {errorAlert}
        <div>
          <Button type="submit" size="lg" disabled={pending || !email.trim()}>
            {pending ? "Sending…" : "Email me a code"}
          </Button>
        </div>
      </form>
      {googleEnabled && (
        <Button type="button" size="lg" variant="outline" disabled={pending} onClick={() => void continueWithGoogle()} className="self-start">
          Continue with Google
        </Button>
      )}
    </div>
  );
}
