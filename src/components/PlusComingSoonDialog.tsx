import { RoamiePlusIntroDialog } from "@/components/RoamiePlusIntroDialog";

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

/** Backward-compatible Plus entry: opens the formal StoreKit/RevenueCat flow. */
export function PlusComingSoonDialog(props: Props) {
  return <RoamiePlusIntroDialog {...props} feature="general" />;
}
