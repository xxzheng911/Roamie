-- Trip Workspace V1 phase 5: private per-member packing lists ("my luggage").
--
-- Tables : packing_categories, packing_items
-- Access : every row belongs to exactly one user (user_id). RLS FOR ALL:
--            user_id = auth.uid() AND (accepted member OR owner of the trip)
--          Nobody else (trip owner / other members) can read or write it. No RPC
--          exposes another user's list. anon has no privileges.
--          Rows of a member who left / was removed are kept but unreadable
--          (RLS fails); re-joining makes them visible again.
--          Deleted together with the trip (saved_trips ON DELETE CASCADE) or the
--          account (auth.users ON DELETE CASCADE).
-- RPCs   : ensure_my_packing_categories(p_trip_id)     -> SETOF packing_categories
--          ensure_my_packing_other_category(p_trip_id) -> packing_categories
--
-- Default-category rule:
--   Unique index (trip_id, user_id, default_key) WHERE default_key IS NOT NULL
--   deliberately does NOT exclude soft-deleted rows: each default_key exists at
--   most once per user per trip, alive or soft-deleted. "Re-creating" a default
--   category therefore always means restoring its row (deleted_at = NULL).
--   ensure_my_packing_categories seeds the 6 defaults only when the user has NO
--   category row at all (alive or soft-deleted) for the trip, so deleted defaults
--   are never revived. ensure_my_packing_other_category restores / creates only
--   the 'other' category (used when every category was deleted and an item is
--   added).
--
-- Soft delete of a category cascades to its live items (same deleted_at);
-- restoring the category restores exactly those items (deleted_at match), except
-- when restored by ensure_my_packing_other_category.
--
-- Error codes (RAISE EXCEPTION '<code>'), none in SQLSTATE class 40:
--   not_authenticated               42501
--   not_trip_member                 42501
--   packing_immutable_field         22023
--   packing_invalid_icon            22023
--   packing_invalid_default_key     22023
--   packing_category_deleted        22023
--   packing_category_not_found      P0002
--   packing_category_limit_reached  54000   (30 live categories / user / trip)
--   packing_item_limit_reached      54000   (500 live items / user / trip)
--   + CHECK constraint violations   23514, unique violations 23505
--
-- Not added to supabase_realtime publication. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.packing_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.saved_trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  default_key text,
  name text,
  icon_key text NOT NULL DEFAULT 'Package',
  sort_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT packing_categories_default_key_check CHECK (
    default_key IS NULL
    OR default_key IN ('clothing', 'toiletries', 'electronics', 'documents', 'medicine', 'other')
  ),
  CONSTRAINT packing_categories_name_check CHECK (
    name IS NULL OR (char_length(btrim(name)) >= 1 AND char_length(name) <= 40)
  ),
  CONSTRAINT packing_categories_custom_name_check CHECK (default_key IS NOT NULL OR name IS NOT NULL),
  CONSTRAINT packing_categories_icon_key_check CHECK (icon_key IN (
    'Shirt', 'Footprints', 'ShowerHead', 'Sparkles', 'Smartphone', 'Plug', 'Camera', 'IdCard',
    'Wallet', 'Pill', 'HeartPulse', 'Umbrella', 'Sun', 'Baby', 'Gift', 'Package'
  ))
);

COMMENT ON COLUMN public.packing_categories.name IS
  'NULL for untouched default categories (client shows localized label for default_key).';

-- Includes soft-deleted rows on purpose (see header): a default category is
-- restored, never duplicated.
CREATE UNIQUE INDEX IF NOT EXISTS packing_categories_trip_user_default_key_idx
  ON public.packing_categories (trip_id, user_id, default_key)
  WHERE default_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS packing_categories_trip_user_sort_idx
  ON public.packing_categories (trip_id, user_id, sort_index)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS packing_categories_user_idx
  ON public.packing_categories (user_id);

CREATE TABLE IF NOT EXISTS public.packing_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.saved_trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.packing_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  note text,
  is_checked boolean NOT NULL DEFAULT false,
  checked_at timestamptz,
  sort_index integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  client_request_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT packing_items_name_check CHECK (char_length(btrim(name)) >= 1 AND char_length(name) <= 80),
  CONSTRAINT packing_items_quantity_check CHECK (quantity BETWEEN 1 AND 99),
  CONSTRAINT packing_items_note_check CHECK (note IS NULL OR char_length(note) <= 200),
  CONSTRAINT packing_items_version_check CHECK (version >= 1),
  CONSTRAINT packing_items_user_client_request_key UNIQUE (user_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS packing_items_trip_user_category_sort_idx
  ON public.packing_items (trip_id, user_id, category_id, sort_index)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS packing_items_category_idx
  ON public.packing_items (category_id);

-- ---------------------------------------------------------------------------
-- 2. RLS + table privileges
-- ---------------------------------------------------------------------------
ALTER TABLE public.packing_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packing_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS packing_categories_own ON public.packing_categories;
CREATE POLICY packing_categories_own ON public.packing_categories
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    AND (public.is_trip_accepted_member(trip_id) OR public.is_trip_owner(trip_id))
  )
  WITH CHECK (
    user_id = auth.uid()
    AND (public.is_trip_accepted_member(trip_id) OR public.is_trip_owner(trip_id))
  );

DROP POLICY IF EXISTS packing_items_own ON public.packing_items;
CREATE POLICY packing_items_own ON public.packing_items
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    AND (public.is_trip_accepted_member(trip_id) OR public.is_trip_owner(trip_id))
  )
  WITH CHECK (
    user_id = auth.uid()
    AND (public.is_trip_accepted_member(trip_id) OR public.is_trip_owner(trip_id))
  );

REVOKE ALL ON TABLE public.packing_categories, public.packing_items
  FROM PUBLIC, anon, authenticated;
-- 不開放 DELETE：一律軟刪除（deleted_at）。硬刪除全部分類會讓 ensure_my_packing_categories 重建預設分類。
-- 行程／帳號刪除的 CASCADE 以表擁有者身分執行，不受此限制。
GRANT SELECT, INSERT, UPDATE ON TABLE public.packing_categories, public.packing_items
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Triggers
--    Validation is skipped when there is no auth.uid() and the role is not a
--    client role (service_role / postgres maintenance). FK cascades (trip or
--    account deletion) only DELETE rows and never fire these triggers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.packing_categories_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_validate boolean := true;
  v_need_limit boolean := false;
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    IF current_user IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;
    v_validate := false;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_validate THEN
      NEW.user_id := v_uid;
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    IF NEW.deleted_at IS NOT NULL THEN
      NEW.deleted_at := now();
    END IF;
    v_need_limit := NEW.deleted_at IS NULL;
  ELSE
    IF v_validate AND (
      NEW.trip_id IS DISTINCT FROM OLD.trip_id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.default_key IS DISTINCT FROM OLD.default_key
    ) THEN
      RAISE EXCEPTION 'packing_immutable_field' USING ERRCODE = '22023';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      NEW.deleted_at := now();
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT NULL THEN
      NEW.deleted_at := OLD.deleted_at;
    END IF;
    v_need_limit := OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL;
  END IF;

  IF NOT v_validate THEN
    RETURN NEW;
  END IF;

  IF NEW.icon_key IS NULL OR NEW.icon_key NOT IN (
    'Shirt', 'Footprints', 'ShowerHead', 'Sparkles', 'Smartphone', 'Plug', 'Camera', 'IdCard',
    'Wallet', 'Pill', 'HeartPulse', 'Umbrella', 'Sun', 'Baby', 'Gift', 'Package'
  ) THEN
    RAISE EXCEPTION 'packing_invalid_icon' USING ERRCODE = '22023';
  END IF;

  IF NEW.default_key IS NOT NULL AND NEW.default_key NOT IN (
    'clothing', 'toiletries', 'electronics', 'documents', 'medicine', 'other'
  ) THEN
    RAISE EXCEPTION 'packing_invalid_default_key' USING ERRCODE = '22023';
  END IF;

  IF v_need_limit THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'packing_categories:' || NEW.trip_id::text || ':' || NEW.user_id::text, 0));
    SELECT count(*) INTO v_count
    FROM public.packing_categories c
    WHERE c.trip_id = NEW.trip_id
      AND c.user_id = NEW.user_id
      AND c.deleted_at IS NULL
      AND c.id <> NEW.id;
    IF v_count >= 30 THEN
      RAISE EXCEPTION 'packing_category_limit_reached' USING ERRCODE = '54000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.packing_categories_before_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS packing_categories_before_write ON public.packing_categories;
CREATE TRIGGER packing_categories_before_write
  BEFORE INSERT OR UPDATE ON public.packing_categories
  FOR EACH ROW EXECUTE FUNCTION public.packing_categories_before_write();

-- Soft delete / restore of a category cascades to its items.
CREATE OR REPLACE FUNCTION public.packing_categories_after_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE public.packing_items i
    SET deleted_at = NEW.deleted_at
    WHERE i.category_id = NEW.id
      AND i.deleted_at IS NULL;
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
    AND coalesce(current_setting('roamie.packing_skip_item_restore', true), '') <> 'on' THEN
    UPDATE public.packing_items i
    SET deleted_at = NULL
    WHERE i.category_id = NEW.id
      AND i.deleted_at = OLD.deleted_at;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.packing_categories_after_soft_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS packing_categories_after_soft_delete ON public.packing_categories;
CREATE TRIGGER packing_categories_after_soft_delete
  AFTER UPDATE ON public.packing_categories
  FOR EACH ROW
  WHEN (OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION public.packing_categories_after_soft_delete();

CREATE OR REPLACE FUNCTION public.packing_items_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_validate boolean := true;
  v_need_category boolean := false;
  v_need_limit boolean := false;
  v_cat_trip uuid;
  v_cat_user uuid;
  v_cat_deleted timestamptz;
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    IF current_user IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
    END IF;
    v_validate := false;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_validate THEN
      NEW.user_id := v_uid;
    END IF;
    NEW.version := 1;
    NEW.created_at := now();
    NEW.updated_at := now();
    NEW.checked_at := CASE WHEN NEW.is_checked THEN now() ELSE NULL END;
    IF NEW.deleted_at IS NOT NULL THEN
      NEW.deleted_at := now();
    END IF;
    v_need_category := NEW.deleted_at IS NULL;
    v_need_limit := NEW.deleted_at IS NULL;
  ELSE
    IF v_validate AND (
      NEW.trip_id IS DISTINCT FROM OLD.trip_id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.client_request_id IS DISTINCT FROM OLD.client_request_id
    ) THEN
      RAISE EXCEPTION 'packing_immutable_field' USING ERRCODE = '22023';
    END IF;
    NEW.created_at := OLD.created_at;
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
    IF NEW.is_checked AND NOT OLD.is_checked THEN
      NEW.checked_at := now();
    ELSIF NOT NEW.is_checked THEN
      NEW.checked_at := NULL;
    ELSE
      NEW.checked_at := OLD.checked_at;
    END IF;
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      NEW.deleted_at := now();
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT NULL THEN
      NEW.deleted_at := OLD.deleted_at;
    END IF;
    v_need_category := NEW.deleted_at IS NULL
      AND (NEW.category_id IS DISTINCT FROM OLD.category_id OR OLD.deleted_at IS NOT NULL);
    v_need_limit := OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL;
  END IF;

  IF NOT v_validate THEN
    RETURN NEW;
  END IF;

  IF v_need_category THEN
    SELECT c.trip_id, c.user_id, c.deleted_at
      INTO v_cat_trip, v_cat_user, v_cat_deleted
    FROM public.packing_categories c
    WHERE c.id = NEW.category_id
    FOR SHARE;
    IF NOT FOUND OR v_cat_trip <> NEW.trip_id OR v_cat_user <> NEW.user_id THEN
      RAISE EXCEPTION 'packing_category_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_cat_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'packing_category_deleted' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_need_limit THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'packing_items:' || NEW.trip_id::text || ':' || NEW.user_id::text, 0));
    SELECT count(*) INTO v_count
    FROM public.packing_items i
    WHERE i.trip_id = NEW.trip_id
      AND i.user_id = NEW.user_id
      AND i.deleted_at IS NULL
      AND i.id <> NEW.id;
    IF v_count >= 500 THEN
      RAISE EXCEPTION 'packing_item_limit_reached' USING ERRCODE = '54000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.packing_items_before_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS packing_items_before_write ON public.packing_items;
CREATE TRIGGER packing_items_before_write
  BEFORE INSERT OR UPDATE ON public.packing_items
  FOR EACH ROW EXECUTE FUNCTION public.packing_items_before_write();

-- ---------------------------------------------------------------------------
-- 4. ensure_my_packing_categories(p_trip_id) -> SETOF packing_categories
--    Seeds the 6 default categories only if the caller has NO category row
--    (alive or soft-deleted) for this trip; otherwise a no-op. Idempotent and
--    safe under concurrent calls (advisory lock + ON CONFLICT DO NOTHING).
--    Returns the caller's live categories ordered by sort_index, created_at, id.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.ensure_my_packing_categories(uuid);
CREATE FUNCTION public.ensure_my_packing_categories(p_trip_id uuid)
RETURNS SETOF public.packing_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_trip_id IS NULL
    OR NOT (public.is_trip_accepted_member(p_trip_id) OR public.is_trip_owner(p_trip_id)) THEN
    RAISE EXCEPTION 'not_trip_member' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'packing_categories:' || p_trip_id::text || ':' || v_uid::text, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.packing_categories c
    WHERE c.trip_id = p_trip_id AND c.user_id = v_uid
  ) THEN
    INSERT INTO public.packing_categories (trip_id, user_id, default_key, name, icon_key, sort_index)
    SELECT p_trip_id, v_uid, d.default_key, NULL, d.icon_key, d.sort_index
    FROM (VALUES
      ('clothing', 'Shirt', 0),
      ('toiletries', 'ShowerHead', 1),
      ('electronics', 'Smartphone', 2),
      ('documents', 'IdCard', 3),
      ('medicine', 'Pill', 4),
      ('other', 'Package', 5)
    ) AS d(default_key, icon_key, sort_index)
    ON CONFLICT (trip_id, user_id, default_key) WHERE default_key IS NOT NULL DO NOTHING;
  END IF;

  RETURN QUERY
    SELECT c.*
    FROM public.packing_categories c
    WHERE c.trip_id = p_trip_id
      AND c.user_id = v_uid
      AND c.deleted_at IS NULL
    ORDER BY c.sort_index, c.created_at, c.id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_my_packing_categories(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_my_packing_categories(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. ensure_my_packing_other_category(p_trip_id) -> packing_categories
--    Returns the caller's live 'other' category for the trip:
--      - live 'other' exists      -> returned unchanged
--      - soft-deleted 'other'     -> restored (name NULL, icon Package, moved to
--                                    the end); its old items stay deleted
--      - no 'other' row at all    -> created at the end
--    Subject to the 30 live categories limit.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.ensure_my_packing_other_category(uuid);
CREATE FUNCTION public.ensure_my_packing_other_category(p_trip_id uuid)
RETURNS public.packing_categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.packing_categories%ROWTYPE;
  v_sort integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_trip_id IS NULL
    OR NOT (public.is_trip_accepted_member(p_trip_id) OR public.is_trip_owner(p_trip_id)) THEN
    RAISE EXCEPTION 'not_trip_member' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'packing_categories:' || p_trip_id::text || ':' || v_uid::text, 0));

  SELECT c.* INTO v_row
  FROM public.packing_categories c
  WHERE c.trip_id = p_trip_id
    AND c.user_id = v_uid
    AND c.default_key = 'other'
  FOR UPDATE;

  IF FOUND AND v_row.deleted_at IS NULL THEN
    RETURN v_row;
  END IF;

  SELECT coalesce(max(c.sort_index) + 1, 0) INTO v_sort
  FROM public.packing_categories c
  WHERE c.trip_id = p_trip_id
    AND c.user_id = v_uid
    AND c.deleted_at IS NULL;

  IF v_row.id IS NOT NULL THEN
    PERFORM set_config('roamie.packing_skip_item_restore', 'on', true);
    UPDATE public.packing_categories c
    SET deleted_at = NULL, name = NULL, icon_key = 'Package', sort_index = v_sort
    WHERE c.id = v_row.id
    RETURNING c.* INTO v_row;
    PERFORM set_config('roamie.packing_skip_item_restore', 'off', true);
  ELSE
    INSERT INTO public.packing_categories (trip_id, user_id, default_key, name, icon_key, sort_index)
    VALUES (p_trip_id, v_uid, 'other', NULL, 'Package', v_sort)
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_my_packing_other_category(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_my_packing_other_category(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
