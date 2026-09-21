import { translate } from "@/lib/i18n/translate";
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
/** Router pending UI — keep free of mascot / sheet imports so login cold start stays lean */
export function RoamieRoutePending() {
  const uiT = (key: string) => translate(effectiveAppLocale(), key);

  return (
    <div
      data-loading-owner="router-pending"
      className="roamie-splash roamie-splash--boot-cream"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="roamie-splash__gradient" aria-hidden />
      <div className="roamie-splash__viewport">
        <div className="roamie-splash__content roamie-splash__content--fade-in">
          <div className="roamie-splash__wordmark">
            <h1 className="roamie-splash__brand">Roamie</h1>
            <p className="roamie-splash__tagline">Less planning, more wandering.</p>
          </div>
          <div className="roamie-splash__loader" aria-label={uiT("productionUi.p656c48dad3")}>
            <span className="roamie-splash__loader-dot" />
            <span className="roamie-splash__loader-dot" />
            <span className="roamie-splash__loader-dot" />
          </div>
        </div>
      </div>
    </div>
  );
}
