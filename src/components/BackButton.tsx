import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

type BackTarget = {
  to: string;
  search?: Record<string, string>;
};

type Props = {
  fallback: BackTarget;
  /** 為 true 時一律回到 fallback，不依赖瀏覽器 history */
  preferFallback?: boolean;
  className?: string;
  label?: string;
  onBack?: () => void;
};

export function BackButton({ fallback, preferFallback, className, label = "返回", onBack }: Props) {
  const navigate = useNavigate();

  const handleBack = () => {
    onBack?.();
    if (!preferFallback && typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    navigate({ to: fallback.to, search: fallback.search });
  };

  return (
    <button
      type="button"
      onClick={handleBack}
      className={className}
      aria-label={label}
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
  );
}
