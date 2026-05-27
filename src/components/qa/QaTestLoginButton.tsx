import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { isQaBuildEnabled } from "@/lib/qa-auth/build";
import { signInAsQaTestUser } from "@/lib/qa-auth/client";

type Props = {
  disabled?: boolean;
  onSuccess?: () => void;
};

export function QaTestLoginButton({ disabled, onSuccess }: Props) {
  const [busy, setBusy] = useState(false);

  if (!isQaBuildEnabled()) return null;

  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={() => {
        setBusy(true);
        void signInAsQaTestUser()
          .then((result) => {
            if (!result.ok) {
              toast.error(result.message);
              return;
            }
            toast.success("已登入 QA 測試帳號");
            onSuccess?.();
          })
          .finally(() => setBusy(false));
      }}
      className="flex w-full items-center justify-center gap-2 rounded-full border-2 border-dashed border-amber-500/60 bg-amber-500/10 py-3.5 text-[14px] font-medium text-amber-900 transition active:scale-[0.98] disabled:opacity-50 dark:text-amber-100"
    >
      <FlaskConical className="h-4 w-4 shrink-0" aria-hidden />
      {busy ? "測試登入中…" : "測試登入（QA · 無需 Google / Apple）"}
    </button>
  );
}
