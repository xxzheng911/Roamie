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
import { TRIP_DELETE_DIALOG } from "@/lib/saved-trip/delete-trip";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  confirming?: boolean;
};

export function TripDeleteConfirmDialog({ open, onOpenChange, onConfirm, confirming }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{TRIP_DELETE_DIALOG.title}</AlertDialogTitle>
          <AlertDialogDescription>{TRIP_DELETE_DIALOG.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={confirming}>{TRIP_DELETE_DIALOG.cancel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={confirming}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              void onConfirm();
            }}
          >
            {TRIP_DELETE_DIALOG.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
