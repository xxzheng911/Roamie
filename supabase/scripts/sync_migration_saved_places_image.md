# saved_places 圖片欄位 migration 修復

## 問題

舊版 `saved_places` 只有 `cover_image`，沒有 `photo_url`。若 migration 直接執行：

```sql
UPDATE saved_places SET cover_image = photo_url ...
```

會失敗：`column "photo_url" does not exist`。

## Canonical 欄位（App + DB）

| 欄位 | 用途 |
|------|------|
| `cover_image` | **主要**顯示 URL（寫入優先） |
| `image_url` | 與 `cover_image` 同步（查詢／API） |
| `image_source` | `google` \| `unsplash` \| `default` |
| `metadata` | 僅放 `placeId` 等，**不再**混用多種圖片 key |

Legacy（僅 backfill 時讀取，若欄位存在）：`photo_url`、`metadata->photoUrl` 等。

## 套用順序

1. 已修正的舊 migration（`20260523120000`、`20260525120000`、`20260527180000` 等）— 新環境 `supabase db push` 即可。
2. **若遠端已卡在失敗 migration**，在 SQL Editor 執行：
   - `supabase/migrations/20260529090000_roamie_schema_helpers.sql`
   - `supabase/migrations/20260529100000_saved_places_image_unified.sql`
   - 或一鍵：`supabase/scripts/saved_places_image_backfill.sql`
3. 在 `supabase_migrations.schema_migrations` 標記失敗版本為已修復（依你們 repair 流程）。

## 驗證

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'saved_places'
ORDER BY column_name;
```

應至少包含：`cover_image`、`image_url`、`image_source`（後兩者由 27180000 / 29100000 新增）。
