import roamieTraveler from "@/assets/roamie-traveler.jpg";

/** In-app brand splash — traveler character, not app icon */
export function RoamieSplashScreen() {
  return (
    <div className="roamie-splash" role="status" aria-live="polite" aria-busy="true">
      <div className="roamie-splash__gradient" aria-hidden />
      <div className="roamie-splash__glow roamie-splash__glow--tl" aria-hidden />
      <div className="roamie-splash__glow roamie-splash__glow--br" aria-hidden />

      <svg
        className="roamie-splash__paths"
        viewBox="0 0 390 844"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <path
          className="roamie-splash__path"
          d="M32 260 C110 210, 190 290, 300 230 S 370 150, 348 110"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <path
          className="roamie-splash__path roamie-splash__path--slow"
          d="M60 620 C150 560, 230 680, 320 600 S 385 500, 360 450"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.7"
        />
      </svg>

      <div className="roamie-splash__content">
        <div className="roamie-splash__character-stage">
          <div className="roamie-splash__character-shadow" aria-hidden />
          <img
            src={roamieTraveler}
            alt=""
            className="roamie-splash__character"
            width={240}
            height={320}
          />
        </div>

        <div className="roamie-splash__wordmark">
          <h1 className="roamie-splash__brand">Roamie</h1>
          <p className="roamie-splash__tagline">Less planning, more wandering.</p>
        </div>

        <div className="roamie-splash__loader" aria-label="載入中">
          <span className="roamie-splash__loader-dot" />
          <span className="roamie-splash__loader-dot" />
          <span className="roamie-splash__loader-dot" />
        </div>
      </div>
    </div>
  );
}
