-- Subscription / plan tier columns only (profiles table must already exist)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS subscription_provider text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS plus_available boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_plan_tier_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_plan_tier_check
  CHECK (plan_tier IN ('free', 'plus'));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_subscription_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_subscription_status_check
  CHECK (subscription_status IN ('inactive', 'active', 'trialing', 'expired'));

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_subscription_provider_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_subscription_provider_check
  CHECK (subscription_provider IN ('none', 'revenuecat', 'app_store'));
