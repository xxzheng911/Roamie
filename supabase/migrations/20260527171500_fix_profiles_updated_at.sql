-- profiles 在部分環境建立時沒有 updated_at，但 profiles_set_updated_at 會寫入該欄 →
-- record "new" has no field "updated_at"

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 舊列若因歷史 schema 為 null（極少見）
UPDATE public.profiles
SET updated_at = COALESCE(created_at, now())
WHERE updated_at IS NULL;

-- 僅在資料列實際含有 updated_at 欄位時才更新（避免其他表缺欄時觸發失敗）
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_jsonb(NEW) ? 'updated_at' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
