import { Loader2, Navigation, Search } from "lucide-react";
import { useRef } from "react";

type Props = {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit?: () => void;
  onLocate: () => void;
  locating?: boolean;
  placeholder?: string;
};

function dismissSearchKeyboard(input: HTMLInputElement | null) {
  input?.blur();
  const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.()) {
    void import("@capacitor/keyboard").then(({ Keyboard }) => Keyboard.hide().catch(() => {}));
  }
}

/** 探索頁搜尋列 + 定位（貼近安全區下緣，避免與 _app main 雙重 padding） */
export function MapSearchBarOverlay({
  query,
  onQueryChange,
  onSubmit,
  onLocate,
  locating,
  placeholder,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 px-4 pt-[calc(var(--safe-area-top)+0.5rem)]">
      <div className="pointer-events-auto flex items-center gap-2">
        <form
          className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-border/90 bg-card/95 px-4 py-2.5 shadow-soft backdrop-blur-sm"
          onSubmit={(e) => {
            e.preventDefault();
            dismissSearchKeyboard(inputRef.current);
            onSubmit?.();
          }}
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={placeholder ?? "想去哪裡走走？"}
            className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            autoComplete="off"
          />
        </form>
        <button
          type="button"
          onClick={onLocate}
          disabled={locating}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border/90 bg-card/95 shadow-soft backdrop-blur-sm disabled:opacity-60"
          aria-label="我的位置"
        >
          {locating ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Navigation className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
