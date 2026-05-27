#!/usr/bin/env bash
# 將「遠端已有較新 migration，但本地中間版本未登記」的 gap 標記為 applied。
# 僅在確認遠端 schema 已包含這些 migration 的變更時使用（例如 Lovable / Dashboard 已手動套用）。
#
# 用法（專案根目錄、已 supabase link）：
#   chmod +x supabase/scripts/repair_migration_gap.sh
#   ./supabase/scripts/repair_migration_gap.sh
#
# 不會執行 SQL、不會 reset database。

set -euo pipefail

VERSIONS=(
  20260522160100
  20260523120000
  20260524120000
  20260525120000
  20260525130000
  20260527171500
  20260527180000
  20260527200000
  20260527210000
)

echo "==> Repair migration history (mark as applied, no SQL rerun)"
for v in "${VERSIONS[@]}"; do
  echo "    $v"
  supabase migration repair --status applied "$v"
done

echo ""
echo "==> Done. Run: supabase migration list"
