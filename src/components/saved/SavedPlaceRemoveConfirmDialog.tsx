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
  placeName: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  confirming?: boolean;
};

export function SavedPlaceRemoveConfirmDialog({
  open,
  placeName,
  onOpenChange,
  onConfirm,
  confirming,
}: Props) {
  const { t: uiT } = useI18n();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{uiT("productionUi.p7028a164a2")}</AlertDialogTitle>
          <AlertDialogDescription>
            {uiT("productionUi.p5caef69625", { v0: placeName })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={confirming}>
            {uiT("productionUi.p670ec25af8")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={confirming}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              void onConfirm();
            }}
          >
            {uiT("productionUi.p6135d4159e")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
