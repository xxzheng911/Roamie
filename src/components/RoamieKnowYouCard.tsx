import { HomePersonalizationCard } from "@/components/home/HomePersonalizationCard";
import type { ComponentProps } from "react";

type Props = ComponentProps<typeof HomePersonalizationCard>;

/** @deprecated 請使用 HomePersonalizationCard */
export function RoamieKnowYouCard(props: Props) {
  return <HomePersonalizationCard {...props} />;
}
