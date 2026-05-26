import { ProfileImageCropSheet } from "@/components/profile/ProfileImageCropSheet";

type Props = {
  open: boolean;
  file: File | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (blob: Blob) => void | Promise<void>;
  applying?: boolean;
  cancelLabel?: string;
  doneLabel?: string;
  hint?: string;
};

/** @deprecated 使用 ProfileImageCropSheet；保留既有 import 路徑 */
export function AvatarCropSheet(props: Props) {
  return <ProfileImageCropSheet {...props} variant="avatar" />;
}
