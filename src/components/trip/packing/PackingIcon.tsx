import {
  Baby,
  Camera,
  Footprints,
  Gift,
  HeartPulse,
  IdCard,
  Package,
  Pill,
  Plug,
  Shirt,
  ShowerHead,
  Smartphone,
  Sparkles,
  Sun,
  Umbrella,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { normalizePackingIconKey, type PackingIconKey } from "./packing-model";

const ICONS: Record<PackingIconKey, LucideIcon> = {
  Shirt,
  Footprints,
  ShowerHead,
  Sparkles,
  Smartphone,
  Plug,
  Camera,
  IdCard,
  Wallet,
  Pill,
  HeartPulse,
  Umbrella,
  Sun,
  Baby,
  Gift,
  Package,
};

export function PackingIcon({ iconKey, className }: { iconKey: string; className?: string }) {
  const Icon = ICONS[normalizePackingIconKey(iconKey)];
  return <Icon className={className} aria-hidden />;
}
