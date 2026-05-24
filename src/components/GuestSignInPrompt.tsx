import { Link } from "@tanstack/react-router";
import { LogIn, CloudOff } from "lucide-react";

type GuestSignInPromptProps = {
  title?: string;
  description?: string;
  className?: string;
};

/** 需要帳號的功能入口 — 溫和引導登入，非 debug 樣式 */
export function GuestSignInPrompt({
  title = "登入後，Roamie 能記住你",
  description = "訪客模式的收藏與行程僅保存在本裝置。登入後可同步個人檔案、雲端收藏與偏好設定。",
  className = "",
}: GuestSignInPromptProps) {
  return (
    <div
      className={`flex flex-1 flex-col items-center justify-center px-6 py-12 text-center ${className}`}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-[1.35rem] bg-gradient-to-br from-[#fde8d4]/80 to-[#e8eef5]/70 shadow-soft">
        <CloudOff className="h-7 w-7 text-clay/90" strokeWidth={1.6} />
      </div>
      <h2 className="mt-6 font-display text-[22px] leading-snug text-balance">{title}</h2>
      <p className="mt-3 max-w-[300px] text-[15px] leading-relaxed text-muted-foreground">
        {description}
      </p>
      <Link
        to="/login"
        className="mt-8 flex w-full max-w-[280px] items-center justify-center gap-2 rounded-full bg-ink py-4 text-[15px] font-medium text-background shadow-lift transition active:scale-[0.99]"
      >
        <LogIn className="h-4 w-4" />
        登入或註冊
      </Link>
      <Link
        to="/"
        className="mt-4 text-sm text-muted-foreground underline-offset-2 hover:underline"
      >
        先繼續逛逛
      </Link>
    </div>
  );
}
