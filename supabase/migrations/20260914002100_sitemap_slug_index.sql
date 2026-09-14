-- sitemap_slugs lists every indexable card slug in order. Without this index it reads the whole (wide) cards table and
-- sorts 34k slugs, which took longer than the anon role's 3 s statement timeout on a small hosted database. The partial
-- index holds exactly those slugs in order, so the query can read the index alone.
create index if not exists cards_sitemap_slugs on public.cards (slug)
  where deleted_at is null and legal_commander <> 'not_legal';
