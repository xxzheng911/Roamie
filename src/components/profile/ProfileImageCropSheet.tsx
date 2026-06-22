import { SharedImageCropEditor } from "@/components/media/SharedImageCropEditor";
import type { ImageCropVariant } from "@/lib/image-crop-variants";
import type { CropTransform } from "@/lib/image-crop";

export type ProfileImageCropVariant = ImageCropVariant;

type Props = {
  open: boolean;
  file: File | null;
  variant: ProfileImageCropVariant;
  onOpenChange: (open: boolean) => void;
  onConfirm: (blob: Blob, transform?: CropTransform) => void | Promise<void>;
  applying?: boolean;
  cancelLabel?: string;
  doneLabel?: string;
  initialTransform?: CropTransform | null;
  sheetClassName?: string;
  overlayClassName?: string;
  gestureLogPrefix?: string;
};

/** @deprecated 請改用 SharedImageCropEditor；保留既有 import 路徑 */
export function ProfileImageCropSheet(props: Props) {
  return <SharedImageCropEditor {...props} />;
}
