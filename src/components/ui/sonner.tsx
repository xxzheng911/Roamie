import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/** 避開 iOS 狀態列與動態島（safe-area + 緩衝） */
const TOAST_TOP_OFFSET = "calc(var(--safe-area-top, env(safe-area-inset-top, 0px)) + 12px)";

const Toaster = ({ position = "top-center", offset, ...props }: ToasterProps) => {
  return (
    <Sonner
      position={position}
      offset={
        offset ??
        (position?.startsWith("top")
          ? { top: TOAST_TOP_OFFSET, left: 16, right: 16 }
          : undefined)
      }
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
