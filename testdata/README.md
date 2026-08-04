# 合成 mock data

此目錄只包含可重現的虛構資料，不含真實姓名、地址、電話、身分證字號或其他可識別資料。

## 目錄

- `csv/`、`xls/`、`xlsx/`、`txt/`：四個目錄具有相同的 dataset basename、列數、順序與 15 欄值。CSV 為 UTF-8、TXT 為臺灣政府 BIG-5E 固定 208 bytes／列；所有檔案都沒有標題列。
- `zip/`：四個混合格式情境 ZIP，另有 `excluded-entries.zip`；後者包含一個可處理 CSV、一個捷徑項目與一個不支援副檔名，用來確認可處理檔案保留、其餘項目逐筆排除。
- `manifest.json`：機器可讀的欄位 mock 名稱、dataset 類型、列數、預期摘要與 ZIP entry 清單。

最大檔案為 `clean-large-6000`（6,000 列）。目前共 45 個資料檔，低於 300 個上限。

## 推定欄位名稱

這些名稱只協助閱讀 mock data，是依目前 regex、byte 寬度及 validation hook 推定的測試語意；正式契約仍以「欄位1」至「欄位15」的位置規則為準，UI 不採用業務欄位名稱。

| 欄位 | Mock 名稱 | BIG-5E bytes | 主要線索 |
|---:|---|---:|---|
| 1 | 資料類別 | 1 | `A`／`B` |
| 2 | 區域／機構代碼 | 2 | 2 位數字 |
| 3 | 資料子類型 | 1 | `1` 至 `6` |
| 4 | 來源紀錄編號 | 10 | 固定 10 位數字 |
| 5 | 選填證號 | 10 | 英數、證號 checksum warning、與欄位8連動 |
| 6 | 出生／生效日期 | 8 | 過去的真實西元日期 |
| 7 | 姓名／名稱 | 12 | 必填 BIG-5E 文字 |
| 8 | 性別代碼 | 1 | `1`／`2`，與有效欄位5連動 |
| 9 | 地址 | 120 | 必填 BIG-5E 文字、最寬欄位 |
| 10 | 電話 | 15 | 數字與 `()+#-`；來源空值會明確補預設值 |
| 11 | 必填國民身分證字號 | 10 | 臺灣身分證格式與 checksum |
| 12 | 分類代碼 | 1 | `A` 至 `D` |
| 13 | 登錄日期 | 8 | 過去的真實西元日期 |
| 14 | 異動／終止日期 | 8 | 選填、晚於欄位13 |
| 15 | 異動狀態 | 1 | `1` 至 `4`，與欄位14成對 |

## 情境

- `clean-*`：無 error、warning 或自動修正；`clean-boundaries` 另含 12-byte、120-byte 與 15-byte 精確邊界。
- `modified-phone-default`：欄位10來源為空，驗證流程應留下補值修改紀錄並將該列歸入 warning。
- `warning-optional-id`：欄位5符合 regex 但 checksum 無效，只有 warning。
- `error-validation`：涵蓋 regex、日期、checksum、性別及欄位14／15跨欄錯誤；所有值仍可安全放入 BIG-5E 固定欄寬，使四種格式可保持同值。
- `mixed-*`：clean、modified、warning 與 error 混合。
- `excluded-entries.zip`：`accepted/clean-single.csv` 應正常加入；`excluded/link.csv` 是捷徑項目，`excluded/notes.md` 是不支援副檔名，兩者應安全略過並分行顯示路徑。

重新產生：

```bash
npm run generate:testdata
```

生成器固定使用 `20260804` 作為驗證基準日，避免 dataset 摘要隨執行日期漂移。
