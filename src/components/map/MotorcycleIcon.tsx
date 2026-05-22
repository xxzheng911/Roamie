import { cn } from "@/lib/utils";

/** Roamie 極簡機車圖示（非寫實） */
export function MotorcycleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4 shrink-0", className)}
      aria-hidden
    >
      <circle cx="6.5" cy="17" r="2.75" />
      <circle cx="17.5" cy="17" r="2.75" />
      <path d="M9.25 17h5.5M6.5 17l2.75-5.5h4.5l1.5 3h3.25l1-3" />
      <path d="M13.75 11.5 16 8" />
    </svg>
  );
}
