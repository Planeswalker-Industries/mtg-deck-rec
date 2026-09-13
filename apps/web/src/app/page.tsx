import Link from "next/link";

const features = [
  {
    title: "Cards to add",
    body: "What decks with your commander tend to run that yours doesn't.",
  },
  {
    title: "Cards to cut",
    body: "Low-synergy, redundant, or off-bracket cards — click one to see substitutes.",
  },
  {
    title: "Use what you own",
    body: "Import your collection and only get suggestions you can build today, with the cost difference.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-col gap-10 py-10">
      <section className="flex max-w-2xl flex-col gap-4">
        <h1 className="font-heading text-4xl font-semibold tracking-tight">Upgrade your Commander deck</h1>
        <p className="text-lg text-muted-foreground">
          Paste a decklist to get recommendations based on how other players build with your commander and what
          each card actually does. No account needed.
        </p>
        <div>
          <Link
            href="/deck"
            className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Paste a decklist
          </Link>
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border p-4">
            <h2 className="font-medium">{f.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
