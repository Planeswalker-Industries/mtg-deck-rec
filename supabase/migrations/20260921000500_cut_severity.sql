-- The deck journey deals mandatory cuts first: rule problems, plus severe misfits, cards whose play-rate score with
-- the commander falls below this. A score under 0.2 needs negative synergy (the commander's decks run the card well
-- below its rate elsewhere); a card rare everywhere scores about 0.3 and stays a suggestion. Measured 2026-09-21 on the
-- local corpus, commanders with 50+ decks: 0.7% of the card slots in real decks score under 0.2, against 5% under the
-- 0.35 low-synergy line.
update public.app_config
set value = value || '{"severeSynergyScore": 0.2}'::jsonb, updated_at = now()
where key = 'corpus';
