import { Instagram } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { openExternalUrl } from "@/lib/open-external-url";

/** Public responder link (verified open to anonymous users); never the /edit URL. */
export const ROAMIE_FEEDBACK_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSeDUCdutCqLnG3qg0eXSuYoewiLcsWt06sF_Kq_0CnRE4h2kg/viewform";
export const ROAMIE_INSTAGRAM_URL = "https://www.instagram.com/roamie.tw/";

const LINK_CLASS =
  "inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-[13px] text-muted-foreground transition-colors active:text-foreground";

/** Low-key text links under sign-out; available to guests without any auth gate. */
export function ProfileFeedbackLinks() {
  const { t } = useI18n();
  return (
    <div className="mt-2 flex items-center justify-center gap-1">
      <a
        href={ROAMIE_FEEDBACK_FORM_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          void openExternalUrl(ROAMIE_FEEDBACK_FORM_URL);
        }}
        className={LINK_CLASS}
      >
        {t("profile.feedback")}
      </a>
      <span aria-hidden className="text-[13px] text-muted-foreground/50">
        –
      </span>
      <a
        href={ROAMIE_INSTAGRAM_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t("profile.instagram")}
        onClick={(e) => {
          e.preventDefault();
          void openExternalUrl(ROAMIE_INSTAGRAM_URL);
        }}
        className={LINK_CLASS}
      >
        <Instagram className="h-4 w-4" aria-hidden />
      </a>
    </div>
  );
}
