import { RoamiePlusIntroDialog } from "@/components/RoamiePlusIntroDialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature?: "quiz" | "memory" | "personalized" | "general";
};

/** 相容舊引用：與 RoamiePlusIntroDialog 同一套流程（含 Plus 測試模式） */
export function PlusUpgradeDialog(props: Props) {
  return <RoamiePlusIntroDialog {...props} />;
}
