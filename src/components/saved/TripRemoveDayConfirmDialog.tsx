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
  dayNumber: number;
  stopCount: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function TripRemoveDayConfirmDialog({
  open,
  dayNumber,
  stopCount,
  onOpenChange,
  onConfirm,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>刪除此天？</AlertDialogTitle>
          <AlertDialogDescription>
            {stopCount > 0
              ? `第 ${dayNumber} 天還有 ${stopCount} 個地點，確定要刪除這一天嗎？`
              : `確定要刪除第 ${dayNumber} 天嗎？`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            刪除此天
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
