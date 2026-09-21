import { useI18n } from "@/hooks/use-i18n";
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
  const { t: uiT } = useI18n();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{uiT("productionUi.pe1cd4adbc2")}</AlertDialogTitle>
          <AlertDialogDescription>
            {stopCount > 0
              ? uiT("productionUi.removeDayPlaces", { day: dayNumber, count: stopCount })
              : uiT("productionUi.removeDayEmpty", { day: dayNumber })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{uiT("productionUi.p2cd0f3be87")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {uiT("productionUi.p6298c7d35f")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
