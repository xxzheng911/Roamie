import { useNavigate, type NavigateOptions } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

type BackTarget = {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
};

type Props = {
  fallback: BackTarget | NavigateOptions;
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
    navigate(fallback as NavigateOptions);
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
