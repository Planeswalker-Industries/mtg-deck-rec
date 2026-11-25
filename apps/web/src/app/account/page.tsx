import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { cn } from "cn";
import { DeleteAccount } from "@/components/auth/delete-account";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { TutorialsToggle } from "@/components/tour/tutorials-toggle";
import { isPlatformAdmin } from "@/lib/server/admin";
import { getCurrentUser } from "@/lib/server/auth";
import { buttonVariants } from "@/components/ui/button";
import { PAGE_SHEET } from "@/lib/constants";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return (
    <section aria-labelledby="account-heading" className={cn(PAGE_SHEET, "max-w-prose")}>
      <h1 id="account-heading" className="font-heading text-2xl leading-none font-semibold tracking-tight">
        Your account
      </h1>
      <Suspense
        fallback={
          <p role="status" className="text-sm text-muted-foreground">
            Loading your account…
          </p>
        }
      >
        <AccountDetails />
      </Suspense>
    </section>
  );
}

async function AccountDetails() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/account");
  return (
    <>
      <p>
        Signed in as <span className="font-semibold">{user.email ?? "your Google account"}</span>.
      </p>
      <TutorialsToggle />
      {/* The link to /admin itself. The header only links an admin to /admin/reports, and only while reports are
          open. */}
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
