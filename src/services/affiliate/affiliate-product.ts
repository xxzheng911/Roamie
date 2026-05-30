import type { Tables } from "@/integrations/supabase/types";

/** Supabase table name for curated affiliate offers (schema reserved; no client CRUD yet). */
export const AFFILIATE_PRODUCTS_TABLE = "affiliate_products" as const;

/** Row shape for `public.affiliate_products`. */
export type AffiliateProduct = Tables<"affiliate_products">;

/** Known platforms; table `platform` is text for forward-compatible partner ids. */
export type AffiliateProductPlatform =
  | "klook"
  | "kkday"
  | (string & {});

export type AffiliateProductInsert = Omit<
  AffiliateProduct,
  "id" | "created_at"
> & {
  id?: string;
  created_at?: string;
};
