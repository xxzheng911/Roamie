import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  confirming?: boolean;
};

export function TripDeleteConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onOpenChange,
  onConfirm,
  confirming,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[min(32rem,calc(100vw-2rem))] overflow-x-hidden">
        <AlertDialogHeader className="min-w-0">
          <AlertDialogTitle className="break-words whitespace-normal">{title}</AlertDialogTitle>
          <AlertDialogDescription className="break-words whitespace-normal">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="min-w-0">
          <AlertDialogCancel
            disabled={confirming}
            aria-label={cancelLabel}
            className="whitespace-normal break-words"
          >
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={confirming}
            aria-label={confirmLabel}
            className="whitespace-normal break-words bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              void onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
