import { ExternalLink } from "lucide-react";
import { openTabelogExternal } from "@/lib/open-tabelog-external";

type Props = {
  href: string | null | undefined;
  label?: string;
  className?: string;
};

/** 開啟 Tabelog 外部搜尋頁（不抓取、不顯示 Tabelog 評分／排名） */
export function TabelogExternalLink({
  href,
  label = "在 Tabelog 查看",
  className = "",
}: Props) {
  if (!href?.trim()) return null;

  return (
    <button
      type="button"
      onClick={() => void openTabelogExternal(href)}
      className={
        className ||
        "inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground"
      }
    >
      <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
      {label}
    </button>
  );
}
