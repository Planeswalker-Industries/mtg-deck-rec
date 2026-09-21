import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DeleteAccount } from "@/components/auth/delete-account";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { isPlatformAdmin } from "@/lib/server/admin";
import { getCurrentUser } from "@/lib/server/auth";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return (
    <div className="flex max-w-prose flex-col gap-4">
      <h1 className="font-heading text-4xl leading-none font-extrabold tracking-tight">Your account</h1>
      <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading your account…</p>}>
        <AccountDetails />
      </Suspense>
    </div>
  );
}

async function AccountDetails() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/account");
  return (
    <>
      <p>
        Signed in as <span className="font-bold">{user.email ?? "your Google account"}</span>.
      </p>
      {/* The only link to /admin anywhere. It isn't in the header because that would cost every signed-in visitor a
          membership check on every page, to show a link almost nobody can use. */}
      {(await isPlatformAdmin()) && (
        <div>
          <Link href="/admin" className={buttonVariants({ variant: "outline", className: "h-10 px-4" })}>
            Platform admin
          </Link>
        </div>
      )}
      <div>
        <SignOutButton />
      </div>
      <DeleteAccount />
    </>
  );
}
