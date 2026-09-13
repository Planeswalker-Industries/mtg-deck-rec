export function SiteFooter() {
  return (
    <footer className="border-t border-seam text-xs text-muted-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6">
        <p className="max-w-prose">
          Card data and images from{" "}
          <a href="https://scryfall.com" className="underline underline-offset-2 hover:text-foreground">
            Scryfall
          </a>
          . Card roles from the Scryfall Tagger project. Prices are estimates and may be out of date.
        </p>
        <p className="max-w-prose">
          MTG Deck Rec is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by
          Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
        </p>
      </div>
    </footer>
  );
}
