import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What MTG Deck Rec collects, why, who else handles it, and how to delete your account.",
};

const UPDATED = "21 September 2026";

// Boilerplate drafted 2026-09-21 from how the app actually stores data; the owner's decisions are the retention of a
// deleted account's email (abuse prevention) and the use of submitted data (recommendations only, never sold). Keep
// it in step with the code: a new table holding personal data, a new processor or a new cookie means an edit here.
export default function PrivacyPage() {
  return (
    <article className="flex max-w-prose flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-4xl leading-none font-extrabold tracking-tight">Privacy policy</h1>
        <p className="text-sm text-muted-foreground">Last updated {UPDATED}</p>
      </header>

      <p>
        MTG Deck Rec is a noncommercial hobby project that suggests cards for Commander decks. This page explains what we
        collect when you use it, what we do with it, and what you can do about it.
      </p>

      <Section title="The short version">
        <ul className="list-disc space-y-1 pl-5">
          <li>You can use the deck tool without an account. Nothing you paste is stored on our servers unless you save it.</li>
          <li>What you submit — decks, collections, votes — is used to run the site and improve its recommendations.</li>
          <li>We never sell your data, and never use it for anything else. No ads, no advertising or analytics trackers.</li>
          <li>You can delete your account at any time from your account page.</li>
        </ul>
      </Section>

      <Section title="What we collect">
        <dl className="flex flex-col gap-3">
          <Item term="Your account">
            Your email address. If you sign in with Google, Google also shares your name and profile picture address,
            which our sign-in provider stores with the account. We also keep the display name you choose, and when you
            signed up and last signed in.
          </Item>
          <Item term="Decks you save">
            The deck&apos;s name and its cards. The text you pasted is not kept. New decks are public, so anyone with the
            link can see them; you can make a deck private from its page.
          </Item>
          <Item term="Your collection">
            If you import a collection while signed in: each card, and the printing, finish, condition and language when
            your file includes them.
          </Item>
          <Item term="Votes">
            When you rate a suggested replacement, we keep the vote along with what was on screen at the time (the other
            suggestions shown and their order), so we can tell which suggestions work.
          </Item>
          <Item term="A salted hash of your IP address">
            To stop abuse we count requests per visitor. We never store your IP address itself, only a one-way hash of
            it mixed with a secret value. People sharing one network share one hash.
          </Item>
          <Item term="Commander deck lookups">
            When you ask us to gather decks for a commander, we keep the request and that salted hash, to apply limits.
          </Item>
        </dl>
      </Section>

      <Section title="What stays in your browser">
        <p>
          Signed out, your last deck is kept in your browser for 30 days and an imported collection for 7 days, so you
          can pick up where you left off. A few settings (like &quot;only cards I own&quot;) are remembered the same way.
          None of it is sent to us until you use it. Clear it with your browser&apos;s site data settings, or the
          Clear button in the deck tool.
        </p>
        <p>
          The only cookies we set keep you signed in. There are no advertising, analytics or tracking cookies.
        </p>
      </Section>

      <Section title="How we use it">
        <p>
          Anything you submit — decks, collections, votes and lookups — becomes part of how the site works and is used to
          improve its recommendations. For example, saved decks feed the play rates shown on card and commander pages,
          and votes tell us which replacements are good ones. Private decks are hidden from other people but still count
          toward those statistics, which are totals with no names attached.
        </p>
        <p>
          That is the only thing we use it for. We do not sell your data, rent it, share it with advertisers, or use it
          for any other purpose — ever.
        </p>
      </Section>

      <Section title="Who else handles it">
        <p>We use a small number of services to run the site. Each only handles data as needed to provide its service:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Supabase stores the database and handles sign-in.</li>
          <li>Vercel hosts the site and keeps short-lived request logs.</li>
          <li>Google, if you choose to sign in with it.</li>
          <li>An email provider, to send your sign-in codes.</li>
          <li>
            Card images load directly from Scryfall, so your browser contacts Scryfall&apos;s servers when showing them.
          </li>
          <li>
            When you import a deck or collection by pasting a link, our server fetches that link from the site it points
            to.
          </li>
        </ul>
      </Section>

      <Section title="Deleting your account">
        <p>
          You can delete your account from your <Link href="/account" className="underline underline-offset-2">account page</Link>.
          That removes your profile, your saved decks (their links stop working) and your collection. It can&apos;t be
          undone.
        </p>
        <p>Some things are kept after deletion:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Your email address and account id, in our internal records. We keep these to prevent abuse, such as banned
            users signing up again or one person running many accounts. They are not used for anything else.
          </li>
          <li>Your votes, with nothing left that links them to you.</li>
          <li>Statistics your decks contributed to, which never contained your name.</li>
        </ul>
      </Section>

      <Section title="Children">
        <p>The site is not directed at children under 13, and we do not knowingly collect their data.</p>
      </Section>

      <Section title="Changes and questions">
        <p>
          If this policy changes, the date at the top will change with it. Questions can go to the project&apos;s{" "}
          <a href="https://github.com/Planeswalker-Industries/mtg-deck-rec/issues" className="underline underline-offset-2">
            issue tracker
          </a>
          .
        </p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-heading text-2xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-bold">{term}</dt>
      <dd className="text-muted-foreground">{children}</dd>
    </div>
  );
}
