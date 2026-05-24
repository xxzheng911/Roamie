import waveCutout from "@/assets/roamie-brand-mascot-cutout.png";
import walkCutout from "@/assets/roamie-mascot-walk-cutout.png";
import mapCutout from "@/assets/roamie-mascot-map-cutout.png";
import cameraCutout from "@/assets/roamie-mascot-camera-cutout.png";

export type MascotPose = "wave" | "walk" | "map" | "camera";

export const MASCOT_CUTOUTS: Record<MascotPose, string> = {
  wave: waveCutout,
  walk: walkCutout,
  map: mapCutout,
  camera: cameraCutout,
};

export type IntroSlideScene = "welcome" | "journey" | "personal" | "start";

export const INTRO_SCENE_POSE: Record<IntroSlideScene, MascotPose> = {
  welcome: "wave",
  journey: "walk",
  personal: "map",
  start: "camera",
};

export type QuizStepKey = "pace" | "avoid" | "vibe" | "budget";

export const QUIZ_STEP_POSE: Record<QuizStepKey, MascotPose> = {
  pace: "walk",
  avoid: "map",
  vibe: "camera",
  budget: "wave",
};
