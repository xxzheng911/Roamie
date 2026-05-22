import {
  DEFAULT_USER_MARKER_AVATAR,
  isGoogleMapsOverlayReady,
  resolveUserMarkerAvatarSrc,
} from "@/lib/map-user-location-marker";

export const ROAMIE_USER_LOCATION_LABEL = "你現在在這附近";

export type LatLngLiteral = { lat: number; lng: number };

export type UserLocationOverlayHandle = {
  setMap: (map: google.maps.Map | null) => void;
  update: (position: LatLngLiteral, avatarSrc: string) => void;
};

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildMarkerInnerHtml(avatarSrc: string): string {
  const src = escapeAttr(avatarSrc);
  const fallback = escapeAttr(DEFAULT_USER_MARKER_AVATAR);
  return `
    <div class="roamie-user-loc__pulses" aria-hidden="true">
      <span class="roamie-user-loc__pulse roamie-user-loc__pulse--1"></span>
      <span class="roamie-user-loc__pulse roamie-user-loc__pulse--2"></span>
    </div>
    <div class="roamie-user-loc__body">
      <div class="roamie-user-loc__avatar-ring">
        <div class="roamie-user-loc__avatar-wrap">
          <img
            src="${src}"
            alt=""
            loading="eager"
            decoding="async"
            referrerpolicy="no-referrer"
            data-fallback="${fallback}"
          />
        </div>
      </div>
      <div class="roamie-user-loc__pointer" aria-hidden="true">
        <span class="roamie-user-loc__pointer-fill"></span>
      </div>
    </div>
  `;
}

type OverlayOptions = {
  avatarSrc: string;
  onClick?: () => void;
};

type OverlayImpl = UserLocationOverlayHandle & google.maps.OverlayView;

let cachedOverlayCtor: (new (
  position: LatLngLiteral,
  options: OverlayOptions,
) => OverlayImpl) | null = null;

/**
 * 僅在 window.google.maps 已載入後建立 Overlay 子類（避免模組載入時存取 google）。
 */
function getOverlayCtor(): (new (
  position: LatLngLiteral,
  options: OverlayOptions,
) => OverlayImpl) | null {
  if (cachedOverlayCtor) return cachedOverlayCtor;
  if (!isGoogleMapsOverlayReady()) return null;

  const OverlayView = window.google!.maps.OverlayView;
  const LatLng = window.google!.maps.LatLng;

  class RoamieUserLocationOverlayImpl extends OverlayView implements UserLocationOverlayHandle {
    private position: LatLngLiteral;
    private avatarSrc: string;
    private onClick?: () => void;
    private container: HTMLDivElement | null = null;
    private imgEl: HTMLImageElement | null = null;

    constructor(position: LatLngLiteral, options: OverlayOptions) {
      super();
      this.position = position;
      this.avatarSrc = resolveUserMarkerAvatarSrc(options.avatarSrc);
      this.onClick = options.onClick;
    }

    update(position: LatLngLiteral, avatarSrc: string) {
      try {
        this.position = position;
        const nextSrc = resolveUserMarkerAvatarSrc(avatarSrc);
        if (nextSrc !== this.avatarSrc) {
          this.avatarSrc = nextSrc;
          if (this.imgEl) this.imgEl.src = nextSrc;
        }
        this.draw();
      } catch (e) {
        console.warn("[Roamie Maps] 更新使用者定位 overlay 失敗", e);
      }
    }

    onAdd() {
      try {
        const div = document.createElement("div");
        div.className = "roamie-user-loc";
        div.setAttribute("role", "button");
        div.setAttribute("tabindex", "0");
        div.setAttribute("aria-label", ROAMIE_USER_LOCATION_LABEL);
        div.innerHTML = buildMarkerInnerHtml(this.avatarSrc);

        this.imgEl = div.querySelector("img");
        if (this.imgEl) {
          const fallback = this.imgEl.dataset.fallback ?? DEFAULT_USER_MARKER_AVATAR;
          this.imgEl.addEventListener("error", () => {
            if (this.imgEl && this.imgEl.src !== fallback) {
              this.imgEl.src = fallback;
            }
          });
        }

        const handleActivate = (e: Event) => {
          e.stopPropagation();
          this.onClick?.();
        };
        div.addEventListener("click", handleActivate);
        div.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleActivate(e);
          }
        });

        this.container = div;
        const pane = this.getPanes()?.overlayMouseTarget ?? this.getPanes()?.floatPane;
        pane?.appendChild(div);
      } catch (e) {
        console.warn("[Roamie Maps] 使用者定位 overlay onAdd 失敗", e);
      }
    }

    draw() {
      try {
        if (!this.container) return;
        const projection = this.getProjection();
        if (!projection) return;
        const point = projection.fromLatLngToDivPixel(
          new LatLng(this.position.lat, this.position.lng),
        );
        if (!point) return;
        this.container.style.left = `${point.x}px`;
        this.container.style.top = `${point.y}px`;
      } catch (e) {
        console.warn("[Roamie Maps] 使用者定位 overlay draw 失敗", e);
      }
    }

    onRemove() {
      this.container?.remove();
      this.container = null;
      this.imgEl = null;
    }
  }

  cachedOverlayCtor = RoamieUserLocationOverlayImpl;
  return cachedOverlayCtor;
}

/** 建立「我的位置」overlay；Google 未就緒或失敗時回傳 null，不拋錯 */
export function createRoamieUserLocationOverlay(
  position: LatLngLiteral,
  options: OverlayOptions,
): UserLocationOverlayHandle | null {
  try {
    const Ctor = getOverlayCtor();
    if (!Ctor) return null;
    return new Ctor(position, {
      avatarSrc: resolveUserMarkerAvatarSrc(options.avatarSrc),
      onClick: options.onClick,
    });
  } catch (e) {
    console.warn("[Roamie Maps] 建立使用者定位 overlay 失敗", e);
    return null;
  }
}
