import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function PlusComingSoonDialog({ open, onOpenChange }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-[min(100%,22rem)] rounded-3xl border-border">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display text-xl leading-snug">
            Roamie Plus 即將推出
          </AlertDialogTitle>
          <AlertDialogDescription className="text-left text-sm leading-relaxed text-muted-foreground">
            未來你可以解鎖更完整的旅行記憶、
            更貼近你的 AI 陪伴，
            以及更深度的個人化旅程體驗。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            className="w-full rounded-full bg-primary py-3 text-sm font-medium"
            onClick={() => onOpenChange(false)}
          >
            我知道了
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
