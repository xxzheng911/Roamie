-- Affiliate product catalog (schema only; no seed data).
-- Future: import from Klook / KKday official APIs via service role.

CREATE TABLE IF NOT EXISTS public.affiliate_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  destination text,
  category text,
  platform text NOT NULL,
  affiliate_url text NOT NULL,
  image_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS affiliate_products_active_destination_idx
  ON public.affiliate_products (destination, category, platform)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS affiliate_products_platform_active_idx
  ON public.affiliate_products (platform)
  WHERE is_active = true;

COMMENT ON TABLE public.affiliate_products IS
  'Curated affiliate offers (Klook, KKday, etc.). Populated later via admin import or partner APIs.';
COMMENT ON COLUMN public.affiliate_products.platform IS
  'Partner id, e.g. klook, kkday';
COMMENT ON COLUMN public.affiliate_products.affiliate_url IS
  'Tracked outbound URL with affiliate parameters';
COMMENT ON COLUMN public.affiliate_products.is_active IS
  'Inactive rows are hidden from client SELECT policies';

ALTER TABLE public.affiliate_products ENABLE ROW LEVEL SECURITY;

-- Read-only catalog for signed-in users (empty until products are imported).
DROP POLICY IF EXISTS "affiliate_products read active" ON public.affiliate_products;
CREATE POLICY "affiliate_products read active"
  ON public.affiliate_products
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- No INSERT/UPDATE/DELETE for authenticated; use service role or dashboard.

GRANT SELECT ON public.affiliate_products TO authenticated;

NOTIFY pgrst, 'reload schema';
