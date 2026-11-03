import type { CSSProperties } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { Home, MessageCircle, Map, Bookmark, User } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";

const items = [
  { to: "/", key: "nav.home", icon: Home },
  { to: "/chat", key: "nav.chat", icon: MessageCircle },
  { to: "/map", key: "nav.explore", icon: Map },
  { to: "/saved", key: "nav.saved", icon: Bookmark },
  { to: "/profile", key: "nav.profile", icon: User },
] as const;

/**
 * iPhone Duo 右側直欄：頂端保留給系統相機與狀態列，不放可點元素（px）。
 * 需在 iPhone Duo 模擬器確認；調整時只改這個常數（以 CSS 變數 --right-rail-top-reserved 套用）。
 */
export const RIGHT_RAIL_TOP_RESERVED_PX = 120;
/** 右側直欄最小寬度（px）；實際寬度＝max(此值, 右側安全區) */
export const RIGHT_RAIL_MIN_WIDTH_PX = 56;
/**
 * 右側直欄寬度的唯一定義。_app 於 rail 時把它設成 <html> 的 --app-rail-width，
 * main 的右側內縮、行程雙欄、styles.css 的 html.duo-rail 規則都讀同一個變數。
 */
export const RIGHT_RAIL_WIDTH_VALUE = `max(${RIGHT_RAIL_MIN_WIDTH_PX}px, var(--safe-area-right))`;
/** 讀取直欄寬度（--app-rail-width 未設定時以同一定義備援） */
export const RIGHT_RAIL_WIDTH_VAR = `var(--app-rail-width, ${RIGHT_RAIL_WIDTH_VALUE})`;

const RIGHT_RAIL_STYLE = {
  "--right-rail-top-reserved": `${RIGHT_RAIL_TOP_RESERVED_PX}px`,
  width: RIGHT_RAIL_WIDTH_VAR,
  paddingTop: "var(--right-rail-top-reserved)",
  paddingBottom: "max(0.75rem, var(--safe-area-bottom))",
} as CSSProperties;

type Props = {
  /** 聊天鍵盤展開時由 html.chat-keyboard-open 隱藏，避免 Tab Bar 被推到鍵盤上方 */
  hiddenOnKeyboard?: boolean;
  /**
   * iPhone Duo：導覽改放右側系統直欄（直向排列）。未傳或 "bottom" 時輸出與修改前相同。
   * 右側直欄不帶 .bottom-nav class：不受鍵盤隱藏規則影響（直欄不會被鍵盤推動），
   * 也不會被聊天版面當成底部 Tab Bar 量測高度。
   */
  placement?: "bottom" | "right-rail";
};

export function BottomNav({ hiddenOnKeyboard = false, placement = "bottom" }: Props) {
  const { pathname } = useLocation();
  const { t } = useI18n();

  if (placement === "right-rail") {
    return (
      <nav
        aria-label={t("nav.main")}
        className="app-right-rail fixed bottom-0 right-0 top-0 z-40 flex flex-col border-l border-border bg-card/95 backdrop-blur-xl"
        style={RIGHT_RAIL_STYLE}
      >
        <ul className="flex flex-1 flex-col items-stretch justify-center gap-1 px-1">
          {items.map((it) => {
            const active = pathname === it.to;
            const Icon = it.icon;
            const label = t(it.key);
            return (
              <li key={it.to}>
                <Link
                  to={it.to}
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-2xl text-[10px] leading-none transition ${
                    active ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <Icon className={`h-5 w-5 ${active ? "stroke-[2.4]" : "stroke-[1.6]"}`} />
                  <span
                    aria-hidden
                    className={`max-w-full truncate ${active ? "font-medium" : ""}`}
                  >
                    {label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav
      aria-label={t("nav.main")}
      className={`bottom-nav fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-xl pb-[var(--safe-area-bottom)] transition-[opacity,transform] duration-200 ${
        hiddenOnKeyboard ? "chat-nav-keyboard-hide" : ""
      }`}
    >
      <ul className="flex h-[var(--bottom-nav-height,4.25rem)] items-center justify-between px-2">
        {items.map((it) => {
          const active = pathname === it.to;
          const Icon = it.icon;
          return (
            <li key={it.to} className="flex-1">
              <Link
                to={it.to}
                className={`flex flex-col items-center gap-1 rounded-2xl py-1.5 text-[11px] transition ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? "stroke-[2.4]" : "stroke-[1.6]"}`} />
                <span className={active ? "font-medium" : ""}>{t(it.key)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
