import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { TEXT_LINK } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What MTG Deck Rec collects, why, who else handles it, and how to delete your account.",
};

const UPDATED = "16 November 2026";

// Boilerplate drafted 2026-09-21 from how the app actually stores data; the owner's decisions are the retention of a
// deleted account's email (abuse prevention) and the use of submitted data (recommendations only, never sold). The
// TCGplayer affiliate links (2026-11-14) fund the servers only and never steer suggestions. Keep it in step with the
// code: a new table holding personal data, a new processor, a new cookie or a new tracking script means an edit here.
export default function PrivacyPage() {
  return (
    <article className="flex max-w-prose flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl leading-none font-semibold tracking-tight">Privacy policy</h1>
        <p className="text-sm text-muted-foreground">Last updated {UPDATED}</p>
      </header>

      <p>
        MTG Deck Rec is a hobby project that suggests cards for Commander decks. This page explains what we collect when
        you use it, what we do with it, how the site pays for itself, and what you can do about it.
      </p>

      <Section title="The short version">
        <ul className="list-disc space-y-1 pl-5">
          <li>You can use the deck tool without an account. Nothing you paste is stored on our servers unless you save it.</li>
          <li>What you submit — decks, collections, votes — is used to run the site and improve its recommendations.</li>
          <li>We never sell your data, and never use it for anything else. No ads and no analytics.</li>
          <li>
            Links to TCGplayer are affiliate links. They help pay for the servers and never change which cards we suggest.
          </li>
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
            your file includes them. A collection is private until you turn on its share link; then anyone with the link
            can see its cards and how many copies you have. Turning the link off stops it working.
          </Item>
          <Item term="Votes">
            When you rate a suggested replacement, we keep the vote along with what was on screen at the time (the other
            suggestions shown and their order), so we can tell which suggestions work.
          </Item>
          <Item term="Suggestions you see">
            When the deck tool shows you cards to add, cut or swap, we record which cards it showed and in what order, and
            which ones you took or passed on, with the deck&apos;s commander and bracket. It tells us how good our
            suggestions are. It is kept like votes: with your account if you are signed in, otherwise with the salted hash
            below, and there is no setting to turn it off.
          </Item>
          <Item term="A salted hash of your IP address">
            To stop abuse we count requests per visitor. We never store your IP address itself, only a one-way hash of
            it mixed with a secret value. People sharing one network share one hash.
          </Item>
          <Item term="Feedback you send">
            When you send feedback or report a deck, we keep your message, the page you sent it from, your account and the
            time. Only the site&apos;s admins read it, to fix what it&apos;s about, and they don&apos;t see your email
            address with it.
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
          The only cookies we set keep you signed in. We use no advertising or analytics cookies, and no third-party
          script runs on our pages. Our TCGplayer links pass through the tracking link of Impact, the affiliate network
          TCGplayer uses, which credits the purchase to us. Once you follow one, Impact and TCGplayer handle that visit
          under their own privacy policies. We don&apos;t send them your decks, your collection or your account details.
        </p>
      </Section>

      <Section title="How the site pays for itself">
        <p>
          The site costs money to run: the database, the hosting and the server that gathers deck statistics. To cover
          those costs, links to TCGplayer are affiliate links. If you follow one and buy cards, TCGplayer pays us a small
          commission. You pay the same price either way. The money goes to running the site.
        </p>
        <p>
          Affiliate links never decide which cards we suggest, how they rank or which ones show a price. Buying is always
          optional: you can copy your decklist and shop anywhere you like.
        </p>
      </Section>

      <Section title="How we use it">
        <p>
          Anything you submit — decks, collections, votes and lookups — becomes part of how the site works and is used to
          improve its recommendations. For example, complete saved decks feed the play rates shown on card and commander
          pages, and votes tell us which replacements are good ones. Private decks are hidden from other people but still
          count toward those statistics, which are totals with no names attached.
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
          <li>
            Impact, TCGplayer&apos;s affiliate network, to credit purchases made through our TCGplayer links. When you
            follow one, TCGplayer and Impact handle that visit under their own privacy policies.
          </li>
        </ul>
      </Section>

      <Section title="Deleting your account">
        <p>
          You can delete your account from your <Link href="/account" className={TEXT_LINK}>account page</Link>.
          That removes your profile, your saved decks (their links stop working), your collection and the feedback you sent. It can&apos;t be
          undone.
        </p>
        <p>Some things are kept after deletion:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Your email address and account id, in our internal records. We keep these to prevent abuse, such as banned
            users signing up again or one person running many accounts. They are not used for anything else.
          </li>
          <li>Your votes and the suggestions you took or passed on, with nothing left that links them to you.</li>
          <li>Statistics your decks contributed to, which never contained your name.</li>
        </ul>
      </Section>

      <Section title="Children">
        <p>The site is not directed at children under 13, and we do not knowingly collect their data.</p>
      </Section>

      <Section title="Changes and questions">
        <p>
          If this policy changes, the date at the top will change with it. Questions can go to us through{" "}
          <Link href="/feedback?from=/privacy" className={TEXT_LINK}>
            Send feedback
          </Link>{" "}
          when you are signed in, or to the project&apos;s{" "}
          <a href="https://github.com/Planeswalker-Industries/mtg-deck-rec/issues" className={TEXT_LINK}>
            issue tracker
          </a>
          .
        </p>
      </Section>

      {/* The site footer links straight here, so it can carry one line instead of these paragraphs. */}
      <Section title="Credits and legal" id="credits">
        <p>
          Card data and images come from{" "}
          <a href="https://scryfall.com" className={TEXT_LINK}>
            Scryfall
          </a>
          . Card roles come from the Scryfall Tagger project. Prices are estimates and may be out of date.
        </p>
        <p>
          MTG Deck Rec is unofficial Fan Content permitted under the{" "}
          <a href="https://company.wizards.com/en/legal/fancontentpolicy" className={TEXT_LINK}>
            Fan Content Policy
          </a>
          . Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast.
          ©Wizards of the Coast LLC.
        </p>
      </Section>
    </article>
  );
}

function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-2 scroll-mt-20">
      <h2 className="font-heading text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-semibold">{term}</dt>
      <dd className="text-muted-foreground">{children}</dd>
    </div>
  );
}
