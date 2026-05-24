import brandMascot from "@/assets/roamie-brand-mascot.png";

export type IntroSlideScene = "welcome" | "journey" | "personal" | "start";

type IntroSlideVisualProps = {
  scene: IntroSlideScene;
  active?: boolean;
};

export function IntroSlideBackdrop({ scene }: { scene: IntroSlideScene }) {
  return (
    <div className="intro-onboard__backdrop" aria-hidden>
      <span className="intro-onboard__glow intro-onboard__glow--tl" />
      <span className="intro-onboard__glow intro-onboard__glow--br" />
      {scene === "journey" && <IntroPathLines />}
      {scene === "personal" && <IntroPlaceDots />}
      {scene === "start" && <span className="intro-onboard__glow intro-onboard__glow--center" />}
    </div>
  );
}

function IntroPathLines() {
  return (
    <svg
      className="intro-onboard__paths"
      viewBox="0 0 390 520"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
    >
      <path
        className="intro-onboard__path"
        d="M40 380 C120 320, 180 420, 260 340 S360 280, 380 220"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        className="intro-onboard__path intro-onboard__path--slow"
        d="M20 440 C100 400, 200 460, 300 380 S360 300, 370 260"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.6"
      />
      <circle className="intro-onboard__path-dot" cx="260" cy="340" r="4" fill="currentColor" />
      <circle
        className="intro-onboard__path-dot intro-onboard__path-dot--delay"
        cx="380"
        cy="220"
        r="3"
        fill="currentColor"
      />
    </svg>
  );
}

function IntroPlaceDots() {
  const spots = [
    { x: "18%", y: "38%", delay: "0s" },
    { x: "72%", y: "32%", delay: "0.4s" },
    { x: "58%", y: "52%", delay: "0.8s" },
    { x: "28%", y: "58%", delay: "1.2s" },
  ];
  return (
    <div className="intro-onboard__spots" aria-hidden>
      {spots.map((s) => (
        <span
          key={`${s.x}-${s.y}`}
          className="intro-onboard__spot"
          style={{ left: s.x, top: s.y, animationDelay: s.delay }}
        />
      ))}
    </div>
  );
}

export function IntroBrandCharacter({ scene, active = true }: IntroSlideVisualProps) {
  const scale =
    scene === "welcome"
      ? "intro-onboard__character--hero"
      : scene === "start"
        ? "intro-onboard__character--finale"
        : "";

  return (
    <div
      className={`intro-onboard__character-stage ${active ? "intro-onboard__character-stage--active" : ""}`}
    >
      <span className="intro-onboard__character-shadow" aria-hidden />
      <img
        src={brandMascot}
        alt=""
        className={`intro-onboard__character ${scale}`}
        draggable={false}
      />
    </div>
  );
}

export function IntroFinalBrand() {
  return (
    <div className="intro-onboard__brand-lockup">
      <p className="intro-onboard__brand-name">Roamie</p>
      <p className="intro-onboard__brand-tagline">Less planning, more wandering.</p>
    </div>
  );
}
