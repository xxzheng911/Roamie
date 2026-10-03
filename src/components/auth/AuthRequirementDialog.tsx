import { useI18n } from "@/hooks/use-i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogin: () => void;
};

export function AuthRequirementDialog({ open, onOpenChange, onLogin }: Props) {
  const { t } = useI18n();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[20rem] rounded-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("authGate.requiredTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("authGate.requiredBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex gap-2">
          <AlertDialogCancel className="mt-0 flex-1">{t("authGate.back")}</AlertDialogCancel>
          <AlertDialogAction
            className="flex-1"
            onClick={(event) => {
              event.preventDefault();
              onLogin();
            }}
          >
            {t("authGate.login")}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
