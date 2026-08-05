# 離線資料轉換

[![CI](https://github.com/sleek874/csv2txt/actions/workflows/ci.yml/badge.svg)](https://github.com/sleek874/csv2txt/actions/workflows/ci.yml)
[![Deploy GitHub Pages](https://github.com/sleek874/csv2txt/actions/workflows/pages.yml/badge.svg)](https://github.com/sleek874/csv2txt/actions/workflows/pages.yml)

一個隱私優先、完全在瀏覽器內處理檔案的通用批次資料工作區。網站以固定 15 欄、每筆 208 bytes 的資料契約為核心，支援：

- 從同一個檔案選擇區載入 CSV、XLS、XLSX、BIG-5E TXT 或 ZIP
- 將所有支援的來源解析為同一種內部表示
- 在下載階段選擇整批輸出為臺灣政府 BIG-5E 固定寬 TXT、UTF-8 CSV 或 XLSX
- 多檔案與遞迴 ZIP 批次處理
- 唯讀規格預覽、逐檔狀態清單、分頁式內部資料預覽
- 驗證後的明確篩選與自動修正，再進行最終驗證及輸出
- 獨立的進階 XLSX 整理流程，以額外參照 Excel 對勾選資料逐列 lookup

所有來源內容、內部資料、驗證結果與輸出都只保留在目前瀏覽器記憶體中，不會上傳至伺服器。

**[開啟目前已部署的版本](https://sleek874.github.io/csv2txt/)**

## 專案狀態

目前版本已完成可追加多檔工作區、ZIP 輸入、共同 Unicode IR 與整批輸出。

目前可運作的範圍包括：

- 預設收合的固定 15 欄規則、可追加的多檔案選擇區、共同 IR 預覽與 100 列分頁。
- ZIP 會延遲載入安全 reader，以可折疊來源／資料夾／檔案樹保留安全虛擬路徑；檔案或整個來源可從工作區移除，也可全部清除。
- CSV、XLS、XLSX、BIG-5E TXT 都進入相同的正規化、來源驗證、明確自動修正及最終驗證流程。
- 在同一份最終 IR 上選擇臺灣政府 BIG-5E 固定寬 TXT、UTF-8 CSV 或 XLSX；單一檔案直接下載，多個檔案保留安全路徑並打包 ZIP。
- Section 1 將可折疊檔案樹與整批摘要合為單一表格，依序顯示資料、正確、錯誤、警告、已選列數、目前輸出格式問題與移除；資料夾與壓縮檔列顯示子項目合計。
- 空白列與可追蹤的自動修正都歸入警告；所有進入共同 IR 的資料列預設納入輸出，可逐列或用「輸出」表頭三態核取方塊調整目前篩選結果的當前頁面，hover／focus 說明仍保留全部問題與修改。
- Section 2 只保留整批格式選擇、簡短下載狀態與下載按鈕；目前格式問題在 Section 1 表格與預覽查看。BIG-5E TXT 以官方 BIG5-2003＋BIG-5E 對照及 byte 寬度檢查勾選列。
- 本機處理、CSP、iframe 防護與離線快取。
- Excel 程式碼與預覽字型的延遲載入。
- Section 3 可另選一個有標題列的 Excel，以欄位11查詢使用者選定的參照欄、加入指定欄位，並下載單一整理後 XLSX；重複與未命中不阻止下載。
- 已驗證的全域視覺、響應式與可及性基礎。

舊設定檔、舊設定 schema、方向 tabs 與相容層已從這個基礎工作區移除。後續功能依 [roadmap](docs/ROADMAP.md) 增加，且每個階段都必須維持建置、測試與目前可用流程正常。

## 固定資料契約

- 15 個位置固定的欄位，只在 UI 顯示 `欄位1` 至 `欄位15`。
- 欄寬固定為 `[1, 2, 1, 10, 10, 8, 12, 1, 120, 15, 10, 1, 8, 8, 1]`，合計 208 bytes。
- 所有來源儲存格先移除全部空白字元；完全空白的資料列不進入 IR，並以原始列號計為一筆警告。
- 所有輸出值靠左，右側使用 `0x20` 補足欄寬。
- BIG-5E TXT 每筆以 CRLF 結束，包括最後一筆。
- 所有進入共同 IR 的資料列預設輸出，不因 error、warning 或自動修正而取消勾選；使用者可在預覽逐列排除。無法歸屬資料列的檔案錯誤仍阻止輸出。

完整欄位規格與驗證規則見 [design specification](docs/DESIGN.md)。

## 處理流程

0. 以預設收合、可展開的清單檢視固定欄位規則。
1. 可重複選擇多個來源並追加至同一工作區；一般檔案位於頂層，ZIP 以可折疊 archive／folder／file tree table 保留安全相對路徑，點選檔案或問題數字後檢視共同 IR。
2. 為整個工作區選擇 TXT（BIG-5E）、CSV（UTF-8）或 XLSX；單一檔案直接下載，多個檔案以輸出 codec 與台北時間命名 ZIP，並保留安全目錄結構。
3. 另選一個有標題列的 XLS／XLSX，選擇工作表、欄位11要查詢的參照欄及要附加的欄位，將所有勾選列合併為 `進階輸出-YYYYMMDDHHmm.xlsx`。每一列獨立處理；重複的 primary row 保留，reference key 多筆命中時展開為多列，未命中時保留 primary row 並填入空白參照值。

> **Section 3 是最小可運作模型（minimal working model）。** 它沒有 error、warning 或 validation gate；所有勾選列都會逐列處理，資料問題、重複與未命中不會阻止下載。欄位8只做輸出 mapping：`1 → 男`、`2 → 女`，其他值原樣保留。

架構責任、內部表示與資源載入邊界見 [architecture](docs/ARCHITECTURE.md)。

## 開發

需求：

- Node.js 24.18.0（由 `.nvmrc` 固定）
- npm 11.16.x

```bash
nvm use
npm ci --ignore-scripts
npm run dev
```

完整本機驗證：

```bash
npm run verify
```

個別檢查：

```bash
npm run check
npm test
npm run build
npm run preview
```

正式建置輸出在 `dist/`。只有在有明確用途時才新增或更新依賴，並同時提交 `package.json` 與 `package-lock.json`。本專案預設停用 dependency lifecycle scripts；不得為方便而全域解除。

## 資料與隱私

測試資料皆為合成資料，不含真實姓名、地址、身分證字號或醫療資料。開發、測試、issue、PR 與文件不得加入真實或可識別資料。

```bash
npm run generate:testdata
```

詳見 [synthetic mock data guide](testdata/README.md) 與 [security policy](SECURITY.md)。

## 文件

- [固定資料與產品規格](docs/DESIGN.md)
- [架構與資源責任](docs/ARCHITECTURE.md)
- [BIG-5E 對照來源與重建方式](docs/BIG5E_MAPPING.md)
- [分階段更新計畫](docs/ROADMAP.md)
- [目前站點健康檢查](docs/SITE_REVIEW.md)
- [貢獻指南](CONTRIBUTING.md)
- [安全政策](SECURITY.md)
- [第三方授權](THIRD_PARTY_NOTICES.md)

目前尚未選定專案本身的授權條款。
