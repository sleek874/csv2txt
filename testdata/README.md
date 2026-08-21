# 合成 mock data

此目錄只包含可重現的虛構資料，不含真實姓名、地址、電話、身分證字號或其他可識別資料。

## 目錄

- `csv/`、`xls/`、`xlsx/`、`txt/`：四個目錄具有相同的 dataset basename、列數、順序與 15 欄值。CSV 為 UTF-8、TXT 為臺灣政府 BIG-5E 固定 208 bytes／列；所有檔案都沒有標題列。
- `zip/`：四個混合格式情境 ZIP、`excluded-entries.zip`、兩個明確標示的極限壓力情境，以及兩個超過 ZIP 安全限制的拒絕情境。`excluded-entries.zip` 包含一個可處理 CSV、一個捷徑項目與一個不支援副檔名，用來確認可處理檔案保留、其餘項目逐筆排除。
- `manifest.json`：機器可讀的欄位 mock 名稱、dataset 類型、列數、預期摘要、一般 ZIP entry 清單、極限情境與拒絕情境契約。

一般 dataset 最大為 `clean-large-6000`（6,000 列）。目前共 49 個 repository fixture，低於 300 個上限。

`extreme-51-txt-6001-rows.zip` 是另外管理的合成壓力情境：內含 51 個相同結構的 BIG-5E TXT，每檔 6,001 列，共 306,051 列、64,270,710 expanded bytes。它刻意超過一般 dataset 的 6,000 列上限；每個 entry 都低於產品的 100 MiB 單檔上限，產品不限制 ZIP 累計展開量。自動測試確認 archive entry、路徑、bytes、CRLF 與抽樣 parser 契約；完整瀏覽器載入、互動延遲與記憶體仍屬人工效能檢查，不由這份 fixture 宣稱通過。

`extreme-200-txt-10000-rows.zip` 是更大的人工瀏覽器壓力情境：內含 200 個相同結構的 BIG-5E TXT，每檔 10,000 列，共 2,000,000 列、420,000,000 expanded bytes。產生器沿用相同的合成資料與 BIG-5E serializer，但以 fixture-only ZIP 包裝避開產品輸出 ZIP 的 100 MiB 累計限制。自動測試只確認 ZIP metadata、路徑、entry 數與單檔界線，不在一般測試中完整解壓或解析；瀏覽器載入、取消、互動延遲與記憶體必須人工檢查。

`over-limit-5001-entries.zip` 含 5,001 個 synthetic CSV entry，比 5,000 個上限多一個。上傳結果應以 error 顯示「壓縮檔內檔案過多」，整個 ZIP 不加入工作區。

`over-limit-11-nested-zips.zip` 含 11 層 ZIP（最外層算第 1 層），比 10 層上限多一層。上傳結果應以 error 顯示「壓縮層數超過限制」，整個 ZIP 不加入工作區。

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
- `error-validation`：涵蓋 regex、日期、checksum、欄位14／15跨欄錯誤，以及性別不一致自動修正 warning；所有來源值仍可安全放入 BIG-5E 固定欄寬，使四種格式可保持同值。
- `mixed-*`：clean、modified、warning 與 error 混合。
- `excluded-entries.zip`：`accepted/clean-single.csv` 應正常加入；`excluded/link.csv` 是捷徑項目，`excluded/notes.md` 是不支援副檔名，兩者應安全略過並分行顯示路徑。
- `extreme-51-txt-6001-rows.zip`：驗證接近大量批次的 ZIP 解壓、entry/path 與固定寬 bytes 契約；不作為一般功能資料集，也不代表主執行緒效能已獲核准。
- `extreme-200-txt-10000-rows.zip`：供人工瀏覽器壓力檢查；一般自動測試只讀取 ZIP metadata，不完整載入 200 萬列。
- `over-limit-5001-entries.zip`：驗證 ZIP entry 數超限時拒絕整個來源，並顯示「壓縮檔內檔案過多」。
- `over-limit-11-nested-zips.zip`：驗證 ZIP 巢狀深度超限時拒絕整個來源，並顯示「壓縮層數超過限制」。

重新產生：

```bash
npm run generate:testdata
```

生成器固定使用 `20260804` 作為驗證基準日，避免 dataset 摘要隨執行日期漂移。
