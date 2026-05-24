import { MASCOT_CUTOUTS, type MascotPose } from "@/lib/mascot-assets";

export type MascotMotion = "float" | "fade-in" | "none";

type RoamieMascotFigureProps = {
  pose: MascotPose;
  variant?: "intro" | "quiz" | "splash";
  className?: string;
  flip?: boolean;
  /** float = subtle vertical drift; fade-in = one-shot appear; none = static */
  motion?: MascotMotion;
};

export function RoamieMascotFigure({
  pose,
  variant = "intro",
  className = "",
  flip = false,
  motion = "float",
}: RoamieMascotFigureProps) {
  const imgClass =
    variant === "intro"
      ? `intro-onboard__character ${className}${flip ? " intro-onboard__character--flip" : ""}`.trim()
      : variant === "splash"
        ? `roamie-splash__character ${className}`.trim()
        : `quiz-mascot__character${flip ? " roamie-mascot-figure__img--flip" : ""}`;

  const shadowClass =
    variant === "intro"
      ? "intro-onboard__character-shadow"
      : variant === "splash"
        ? "roamie-splash__character-shadow"
        : "quiz-mascot__shadow";

  const motionClass =
    motion === "float"
      ? "roamie-mascot-figure--float"
      : motion === "fade-in"
        ? "roamie-mascot-figure--fade-in"
        : "";

  return (
    <div className={`roamie-mascot-figure roamie-mascot-figure--${variant} ${motionClass}`.trim()}>
      <span className={shadowClass} aria-hidden />
      <img src={MASCOT_CUTOUTS[pose]} alt="" draggable={false} className={imgClass} />
    </div>
  );
}
