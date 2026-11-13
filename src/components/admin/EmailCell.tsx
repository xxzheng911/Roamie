import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { maskEmail } from "./admin-format";

/** 預設遮蔽 email；點擊後才顯示完整內容（僅前端遮蔽） */
export function EmailCell({ email }: { email: string | null }) {
  const [revealed, setRevealed] = useState(false);
  if (!email) return <p className="truncate text-xs text-slate-500">無 Email</p>;
  return (
    <button
      type="button"
      onClick={() => setRevealed((value) => !value)}
      aria-label={revealed ? "隱藏完整 Email" : "顯示完整 Email"}
      className="flex max-w-full items-center gap-1 text-left text-xs text-slate-500 hover:text-slate-700"
    >
      <span className="min-w-0 truncate">{revealed ? email : maskEmail(email)}</span>
      <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-sky-700">
        {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        {revealed ? "隱藏" : "顯示"}
      </span>
    </button>
  );
}
