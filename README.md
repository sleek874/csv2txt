# 離線資料轉換

[![CI](https://github.com/sleek874/csv2txt/actions/workflows/ci.yml/badge.svg)](https://github.com/sleek874/csv2txt/actions/workflows/ci.yml)
[![Deploy GitHub Pages](https://github.com/sleek874/csv2txt/actions/workflows/pages.yml/badge.svg)](https://github.com/sleek874/csv2txt/actions/workflows/pages.yml)

一個隱私優先、完全在瀏覽器內處理檔案的通用批次資料工作區。下一個主要版本將以固定 15 欄、每筆 208 bytes 的資料契約為核心，支援：

- 從同一個檔案選擇區載入 CSV、XLS、XLSX、Big5 TXT 或 ZIP
- 將所有支援的來源解析為同一種內部表示
- 在下載階段選擇整批輸出為 Big5 固定寬 TXT 或 XLSX
- 多檔案與遞迴 ZIP 批次處理
- 唯讀規格預覽、逐檔狀態清單、分頁式內部資料預覽
- 驗證後的明確篩選與修改，再進行最終驗證及輸出
- 預留獨立的進階 XLSX 整理流程，以額外參照 workbook 對最終資料執行明確 lookup

所有來源內容、內部資料、驗證結果與輸出都只保留在目前瀏覽器記憶體中，不會上傳至伺服器。

**[開啟目前已部署的版本](https://sleek874.github.io/csv2txt/)**

## 專案狀態

本分支已完成下一個主要版本的可追加多檔工作區與 ZIP 輸入；整批輸出 ZIP 尚未完成。

目前可運作的範圍包括：

- 預設收合的固定 15 欄規則、可追加的多檔案選擇區、共同 IR 預覽與 100 列分頁。
- ZIP 會延遲載入安全 reader，保留安全虛擬路徑；檔案可逐一從工作區移除或全部清除。
- CSV、XLS、XLSX、Big5 TXT 都進入相同的正規化、來源驗證、明確修改及最終驗證流程。
- 在同一份最終 IR 上選擇 Big5 固定寬 TXT 或 XLSX 輸出。
- 錯誤、提醒與修改在摘要、資料列及問題清單中分開呈現；有問題的列預設不輸出，可在預覽明確勾選後納入。
- Big5 round-trip、byte 寬度、CRLF 與前置零處理。
- 本機處理、CSP、iframe 防護與離線快取。
- Excel 程式碼與預覽字型的延遲載入。
- 已驗證的全域視覺、響應式與可及性基礎。

舊設定檔、舊設定 schema、方向 tabs 與相容層已從這個基礎工作區移除。後續功能依 [roadmap](docs/ROADMAP.md) 增加，且每個階段都必須維持建置、測試與目前可用流程正常。

## 固定資料契約

- 15 個位置固定的欄位，只在 UI 顯示 `欄位1` 至 `欄位15`。
- 欄寬固定為 `[1, 2, 1, 10, 10, 8, 12, 1, 120, 15, 10, 1, 8, 8, 1]`，合計 208 bytes。
- 所有來源儲存格先移除全部空白字元；完全空白的資料列會被移除並計數。
- 所有輸出值靠左，右側使用 `0x20` 補足欄寬。
- Big5 TXT 每筆以 CRLF 結束，包括最後一筆。
- 有錯誤或提醒的資料列預設不輸出；使用者可在預覽逐列勾選後強制納入。無法歸屬資料列的檔案錯誤仍阻止輸出。

完整欄位規格與驗證規則見 [design specification](docs/DESIGN.md)。

## 目標處理流程

0. 以預設收合、可展開的清單檢視固定欄位規則（已完成）。
1. 可重複選擇多個來源並追加至同一工作區；ZIP 內支援的檔案會以安全虛擬路徑加入目前的扁平清單，點選後檢視共同 IR。真正的資料夾／archive tree 留在後續階段。
2. 目前可下載樹中選取檔案的 Big5 TXT 或 XLSX；後續批次階段再保留安全目錄結構並打包 ZIP。
3. 未來可選擇額外參照 Excel，對已驗證 IR 執行明確 lookup，產生另一份整理後 XLSX。

Section 3 的 lookup key、參照 worksheet、重複／未命中規則、輸出欄位與檔名仍待確認；目前只顯示不可操作的未開放說明。

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

詳見 [synthetic fixture guide](tests/fixtures/README.md) 與 [security policy](SECURITY.md)。

## 文件

- [固定資料與產品規格](docs/DESIGN.md)
- [架構與資源責任](docs/ARCHITECTURE.md)
- [分階段更新計畫](docs/ROADMAP.md)
- [上一個可運作版本的站點審查基準](docs/SITE_REVIEW.md)
- [貢獻指南](CONTRIBUTING.md)
- [安全政策](SECURITY.md)
- [第三方授權](THIRD_PARTY_NOTICES.md)

目前尚未選定專案本身的授權條款。
