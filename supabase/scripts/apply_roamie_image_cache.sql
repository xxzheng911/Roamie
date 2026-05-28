-- Supabase Dashboard → SQL Editor
-- Shared Unsplash caches + saved_trips destination columns

-- Base tables (idempotent)
\i ../migrations/20260528120000_roamie_image_cache.sql
-- Unsplash metadata columns (idempotent)
\i ../migrations/20260528210000_unsplash_cache_columns.sql
