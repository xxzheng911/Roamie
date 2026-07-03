import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";

export type ImagePickSource = "library" | "camera";

export type ImagePickResult =
  | { ok: true; file: File }
  | { ok: false; cancelled: boolean; error?: string };

const TRIP_COVER_PICK_PREFIX = "[TRIP_COVER_PICK]";

function coverPickLog(
  pickLogPrefix: string | undefined,
  event: "picker_open" | "success" | "cancelled" | "error",
  detail?: string,
): void {
  if (pickLogPrefix !== TRIP_COVER_PICK_PREFIX) return;
  const tag =
    event === "picker_open"
      ? "[TRIP_COVER_PICKER_OPEN]"
      : event === "success"
        ? "[TRIP_COVER_PICK_SUCCESS]"
        : event === "cancelled"
          ? "[TRIP_COVER_PICK_CANCELLED]"
          : "[TRIP_COVER_PICK_ERROR]";
  if (detail) console.info(tag, detail);
  else console.info(tag);
}

function isUserCancelledError(message: string): boolean {
  return /cancel|cancelled|canceled|dismiss|aborted|no image picked/i.test(message);
}

function permissionDeniedMessage(source: ImagePickSource): string {
  return source === "library"
    ? "無法存取相簿，請至「設定」開啟照片權限"
    : "無法使用相機，請至「設定」開啟相機權限";
}

async function photoToFile(
  photo: {
    base64String?: string;
    dataUrl?: string;
    webPath?: string;
    path?: string;
    format?: string;
  },
): Promise<File | null> {
  const format = photo.format?.trim() || "jpeg";
  const mime = format === "png" ? "image/png" : "image/jpeg";
  const filename = `photo_${Date.now()}.${format === "png" ? "png" : "jpg"}`;

  if (photo.base64String?.trim()) {
    const raw = atob(photo.base64String);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    return blob.size > 0 ? new File([blob], filename, { type: mime }) : null;
  }

  const dataUrl = photo.dataUrl?.trim();
  if (dataUrl) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return blob.size > 0 ? new File([blob], filename, { type: blob.type || mime }) : null;
  }

  const uri = photo.webPath?.trim() || photo.path?.trim();
  if (uri) {
    const response = await fetch(uri);
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.size > 0 ? new File([blob], filename, { type: blob.type || mime }) : null;
  }

  return null;
}

async function ensureCameraPermissions(
  source: ImagePickSource,
): Promise<ImagePickResult | null> {
  const { Camera } = await import("@capacitor/camera");
  const current = await Camera.checkPermissions();

  if (source === "library") {
    if (current.photos === "granted" || current.photos === "limited") return null;
    if (current.photos === "denied") {
      return { ok: false, cancelled: false, error: permissionDeniedMessage(source) };
    }
    const requested = await Camera.requestPermissions({ permissions: ["photos"] });
    if (requested.photos !== "granted" && requested.photos !== "limited") {
      return { ok: false, cancelled: false, error: permissionDeniedMessage(source) };
    }
    return null;
  }

  if (current.camera === "granted") return null;
  if (current.camera === "denied") {
    return { ok: false, cancelled: false, error: permissionDeniedMessage(source) };
  }
  const requested = await Camera.requestPermissions({ permissions: ["camera"] });
  if (requested.camera !== "granted") {
    return { ok: false, cancelled: false, error: permissionDeniedMessage(source) };
  }
  return null;
}

/** Capacitor 原生相簿 / 相機選圖（iOS / Android） */
export async function pickImageWithCapacitorCamera(
  source: ImagePickSource,
  options?: {
    cameraFacing?: "user" | "environment";
    pickLogPrefix?: string;
  },
): Promise<ImagePickResult> {
  const pickLogPrefix = options?.pickLogPrefix;

  try {
    const { Camera, CameraDirection, CameraResultType, CameraSource } = await import(
      "@capacitor/camera"
    );

    const permissionError = await ensureCameraPermissions(source);
    if (permissionError) {
      coverPickLog(pickLogPrefix, "error", permissionError.error);
      return permissionError;
    }

    coverPickLog(pickLogPrefix, "picker_open");

    const photo = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      correctOrientation: true,
      resultType: CameraResultType.DataUrl,
      source: source === "library" ? CameraSource.Photos : CameraSource.Camera,
      ...(source === "camera" && options?.cameraFacing === "user"
        ? { direction: CameraDirection.Front }
        : {}),
    });

    const file = await photoToFile(photo);

    if (!file?.size) {
      coverPickLog(pickLogPrefix, "error", "empty image");
      return { ok: false, cancelled: false, error: "未取得圖片，請再試一次" };
    }

    coverPickLog(pickLogPrefix, "success");
    return { ok: true, file };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (isUserCancelledError(msg)) {
      coverPickLog(pickLogPrefix, "cancelled");
      return { ok: false, cancelled: true };
    }
    coverPickLog(pickLogPrefix, "error", msg);
    return { ok: false, cancelled: false, error: msg || "無法開啟圖片選擇器" };
  }
}

export function shouldUseCapacitorImagePicker(): boolean {
  return isCapacitorNativeShell();
}
