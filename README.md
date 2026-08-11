# 離線資料轉換

[![CI](https://github.com/sleek874/csv2txt/actions/workflows/ci.yml/badge.svg)](https://github.com/sleek874/csv2txt/actions/workflows/ci.yml)
[![Deploy GitHub Pages](https://github.com/sleek874/csv2txt/actions/workflows/pages.yml/badge.svg)](https://github.com/sleek874/csv2txt/actions/workflows/pages.yml)

一個隱私優先、完全在瀏覽器內處理檔案的通用批次資料工作區。網站以固定 15 欄、每筆 208 bytes 的資料契約為核心，支援：

- 先以兩個下拉選單選擇輸入與輸出；畫面只顯示 `TXT`、`CSV`、`XLSX`
- 從同一個檔案選擇區載入 TXT、CSV、XLS、XLSX 或 ZIP；XLS 歸入 XLSX
- 將所有支援的來源解析為同一種內部表示
- 只將目前輸入格式列入工作樹與預覽，其他格式保留在獨立清單
- 輸出為臺灣政府 BIG-5E 固定寬 TXT、UTF-8 CSV 或 XLSX
- 多檔案與遞迴 ZIP 批次處理
- 唯讀規格預覽、逐檔狀態清單、分頁式內部資料預覽
- 驗證後的明確篩選與自動修正，再進行最終驗證及輸出
- 獨立的進階 XLSX 整理流程，以額外參照 Excel 對勾選資料逐列 lookup

所有來源內容、內部資料、驗證結果與輸出都只保留在目前瀏覽器記憶體中，不會上傳至伺服器。

**[開啟目前已部署的版本](https://sleek874.github.io/csv2txt/)**

## 專案狀態

目前版本已完成可追加多檔工作區、ZIP 輸入、共同 Unicode IR 與整批輸出。

目前可運作的範圍包括：

- 第 0 區提供獨立的輸入／輸出格式下拉選單；可追加多種檔案，只有目前輸入格式進入共同 IR 預覽與 100 列分頁。
- ZIP 會延遲載入安全 reader，以可折疊來源／資料夾／檔案樹保留安全虛擬路徑；檔案或整個來源可從工作區移除，也可全部清除。
- CSV、XLS、XLSX、BIG-5E TXT 都進入相同的正規化、來源驗證、明確自動修正及最終驗證流程。
- 在同一份最終 IR 上選擇臺灣政府 BIG-5E 固定寬 TXT、UTF-8 CSV 或 XLSX；單一檔案直接下載，多個檔案保留安全路徑並打包 ZIP。
- Section 1 的「本次處理」樹依序顯示空白列、無法解析、資料、正確、錯誤、警告、已選、目前輸出問題與移除；其他格式與未加入項目位於「其他檔案」。
- 空白列獨立計數但不進預覽。可解析的錯誤與警告列仍預設勾選且不阻止一般 CSV／XLSX 輸出；無法解析的列保留原始證據、不能勾選，並阻止不完整批次下載。
- 預覽以狀態儲存格提示問題；點擊後展開全寬說明，不另設問題欄。未還原 PUA 與 encoding 替代位置顯示 `■` 並保留 code point／byte 證據；`■` 不進入資料或輸出。BIG-5E 輸入若只有局部 bytes 無法對照，會保留其餘文字並在 IR 以全形 `？` 代替該段。
- Section 2 只顯示第 0 區已選的格式、下載狀態與下載按鈕。BIG-5E TXT 以官方 BIG5-2003＋BIG-5E 對照逐字輸出；無 mapping 字元以全形 `？` 代替且不阻擋，替代後超過固定欄寬才停止下載。
- 本機處理、CSP、iframe 防護與離線快取。
- Excel 程式碼與預覽字型的延遲載入。
- Section 3 可另選一個有標題列的 Excel，以欄位11查詢使用者選定的參照欄、加入指定欄位，並下載單一整理後 XLSX；重複與未命中不阻止下載。
- 已驗證的全域視覺、響應式與可及性基礎。

舊設定檔、舊設定 schema、方向 tabs 與相容層已從這個基礎工作區移除。後續功能依 [roadmap](docs/ROADMAP.md) 增加，且每個階段都必須維持建置、測試與目前可用流程正常。

## 固定資料契約

- 15 個位置固定的欄位，只在 UI 顯示 `欄位1` 至 `欄位15`。
- 欄寬固定為 `[1, 2, 1, 10, 10, 8, 12, 1, 120, 15, 10, 1, 8, 8, 1]`，合計 208 bytes。
- 所有來源儲存格先移除全部空白字元，半形 `?` 統一為全形 `？`；完全空白的資料列不進入 IR，並以原始列號獨立計數。
- 所有輸出值靠左，右側使用 `0x20` 補足欄寬。
- BIG-5E TXT 每筆以 CRLF 結束，包括最後一筆。
- 所有可解析並進入共同 IR 的資料列預設輸出，不因 error、warning 或自動修正而取消勾選；使用者可在預覽逐列排除。無法解析的來源列與檔案層級錯誤仍阻止輸出。

完整欄位規格與驗證規則見 [design specification](docs/DESIGN.md)。

## 處理流程

0. 以兩個下拉選單分別選擇輸入與輸出 `TXT`、`CSV` 或 `XLSX`。
1. 可重複加入 TXT、CSV、XLS、XLSX 或 ZIP；本次格式進入安全工作樹與預覽，其他格式分開保留。XLS 視為 XLSX，ZIP 只是容器。
2. 直接下載第 0 區選定的格式；單一檔案直接下載，多個檔案以輸出 codec 與台北時間命名 ZIP，並保留安全目錄結構。
3. 另選一個有標題列的 XLS／XLSX，選擇工作表、欄位11要查詢的參照欄及要附加的欄位，將所有勾選列合併為 `進階輸出-YYYYMMDDHHmm.xlsx`。每一列獨立處理；重複的 primary row 保留，reference key 多筆命中時展開為多列，未命中時保留 primary row 並填入空白參照值。

固定 15 欄與 208-byte 規則位於流程底部的可展開參考區。

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

開發與 coding-agent 協作以可供人理解、驗證的最小完整變更為原則；詳見 [貢獻指南](CONTRIBUTING.md)。

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
