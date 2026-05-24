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

export function BottomNav() {
  const { pathname } = useLocation();
  const { t } = useI18n();

  return (
    <nav
      aria-label="主要導覽"
      className="bottom-nav absolute inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-xl pb-[var(--safe-area-bottom)]"
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
