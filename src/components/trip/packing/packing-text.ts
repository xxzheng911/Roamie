import type { TripPackingCopy } from "@/lib/i18n/trip-workspace-copy";
import type { PackingDefaultNames, PackingErrorCode } from "./packing-model";

/** 預設分類（default_key）目前語系名稱 */
export function packingDefaultNames(copy: TripPackingCopy): PackingDefaultNames {
  return {
    clothing: copy.defaultClothing,
    toiletries: copy.defaultToiletries,
    electronics: copy.defaultElectronics,
    documents: copy.defaultDocuments,
    medicine: copy.defaultMedicine,
    other: copy.defaultOther,
  };
}

export function packingErrorMessage(code: PackingErrorCode, copy: TripPackingCopy): string {
  switch (code) {
    case "not_authenticated":
      return copy.errorNotAuthenticated;
    case "not_trip_member":
      return copy.errorNotMember;
    case "packing_invalid_icon":
      return copy.errorInvalidIcon;
    case "packing_category_deleted":
      return copy.errorCategoryDeleted;
    case "packing_category_not_found":
      return copy.errorCategoryNotFound;
    case "packing_category_limit_reached":
      return copy.errorCategoryLimit;
    case "packing_item_limit_reached":
      return copy.errorItemLimit;
    case "packing_item_name_invalid":
      return copy.errorItemName;
    case "packing_item_quantity_invalid":
      return copy.errorQuantity;
    case "packing_item_note_invalid":
      return copy.errorNote;
    case "packing_category_name_invalid":
      return copy.errorCategoryName;
    case "packing_conflict":
      return copy.errorConflict;
    case "network":
      return copy.errorNetwork;
    default:
      return copy.errorUnknown;
  }
}
