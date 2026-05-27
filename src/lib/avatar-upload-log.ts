export function logAvatarApplyPressed(): void {
  console.info("[Avatar Apply Pressed]");
}

export function logAvatarCropResult(detail: Record<string, unknown>): void {
  console.info("[Avatar Crop Result URI]", detail);
}

export function logAvatarFileReadSuccess(detail: Record<string, unknown>): void {
  console.info("[Avatar File Read Success]", detail);
}

export function logAvatarUploadStarted(detail: Record<string, unknown>): void {
  console.info("[Avatar Upload Started]", detail);
}

export function logAvatarUploadFailed(detail: Record<string, unknown>): void {
  console.info("[Avatar Upload Failed]", detail);
}

export function logAvatarUploadSuccess(detail: Record<string, unknown>): void {
  console.info("[Avatar Upload Success]", detail);
}

export function logAvatarPublicUrlCreated(url: string): void {
  console.info("[Avatar Public URL Created]", { url });
}

export function logProfileAvatarUpdateStarted(userId: string): void {
  console.info("[Profile Avatar Update Started]", { userId });
}

export function logProfileAvatarUpdateFailed(detail: Record<string, unknown>): void {
  console.info("[Profile Avatar Update Failed]", detail);
}

export function logProfileAvatarUpdateSuccess(userId: string): void {
  console.info("[Profile Avatar Update Success]", { userId });
}
