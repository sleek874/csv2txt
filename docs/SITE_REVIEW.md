# 站點健康檢查

檢查日期：2026-08-05
範圍：BIG-5E mapping／PUA recovery、共同資料管線、CSV／XLSX／TXT／ZIP I/O、工作區 UI、可及性、響應式版面、離線建置、安全、dependency、測試與文件。

## 結論

目前分支是健康的 release candidate。完整本機 gate、dependency 安全檢查、正式建置 DOM 與桌面／窄螢幕截圖均通過；沒有保留舊 settings、方向 tabs、HKSCS fallback 或第二套 summary state。

本次 audit 額外修正一個資料契約偏差：CSV serializer 曾將每個值改寫成 Excel 文字公式。CSV 現在恢復為標準 literal-value 輸出，固定 UTF-8 BOM、CRLF、無標題列並保存最終 IR；需要可靠的試算表文字型別與前置零時使用 XLSX。

## 目前架構

File／ZIP 依序經過 safe inventory 與 virtual path、format adapter、normalized Unicode IR、來源驗證、可稽核 transformation、最終驗證與 row selection、所選格式 output gate，再輸出 CSV／BIG-5E TXT／XLSX；單檔直接下載，多檔建立保留路徑的 ZIP。

- 固定 profile、IR、validation、transformation、output validation 與 serializer 分層；瀏覽器 view 不持有 domain rule。
- workspace-model.ts 是檔案、選取列與整批輸出格式的唯一狀態；tree、preview 與 download plan 都由 snapshot 即時計算。
- CSV／BIG-5E TXT 是 base codec；Spreadsheet、ZIP 與預覽字型依需求延遲載入並加入對應離線資源群組。

## BIG-5E 與資料完整性

- Runtime mapping 來自數位發展部 CNS11643 MapingTables.zip 版本 20260505，以 SHA-256 固定並產生 17,454 筆非 ASCII 一對一 mapping。
- Codec 不呼叫 WHATWG Big5／HKSCS fallback。衝突位置例如 964F、9BBC 依 BIG-5E 解讀。
- 測試逐一枚舉所有 runtime BIG-5E code，確認 decode／encode round-trip 與 provenance entry count 相符。
- Recovery table 含 4,107 筆官方資料可唯一收斂的 BMP PUA；測試確認輸出皆為 formal Unicode。
- 未解決 PUA 不猜字義、不消失、不被通用 replacement 取代；預覽只遮罩 glyph，IR 與問題明細保留 code point。
- BIG-5E 無對照或 byte overflow 只阻止 BIG-5E TXT；CSV／XLSX 仍可表示已確認的 Unicode。

## UI 與可及性

- 四區順序、原生 rules disclosure、單一 multiple picker、treegrid、100-row preview、三態 page-scoped selection、原生 output select 與未開放 Section 3 都存在於正式 DOM。
- Section 1 合併來源結果、選取列與目前格式 output issue；Section 2 不再複製完整摘要。
- 移除與清空 copy 明確表示只影響頁面記憶體；ZIP 內 symlink 對使用者顯示為「捷徑」。
- 問題 detail 支援 hover、focus 與 click；大量 table body 不作為 live region，只有事件型狀態使用安靜的 polite announcement。
- 1440×1200 與 390×844 正式建置截圖沒有版面溢位、重疊或不可見主要控制。
- Node 24.18.0、Chrome 151.0.7922.71、Lighthouse 13.4.1 對正式 preview root 的本機診斷為 Performance 99、Accessibility 100、Best Practices 100、SEO 92。

自動與 headless 證據不能取代螢幕閱讀器、完整鍵盤操作、原生 file picker、下載 dialog 或真實裝置測試；這些仍列為發布前人工檢查。

## 安全、隱私與離線

- 正式 CSP 保持 connect-src 'none'；沒有 upload endpoint、telemetry、runtime CDN 或第三方連線。
- 檔案內容、路徑、issue、IR 與輸出不寫入 localStorage、IndexedDB、URL 或 log；localStorage 只保存 UI theme。
- ZIP 在解壓前檢查中央目錄，限制 entry、深度、單檔／總大小，拒絕 traversal、控制字元、加密、symlink、ZIP64、未知 compression 與碰撞；實際串流解壓大小也另行計數。
- Service worker 的 base、Excel、archive 與 font 群組由 Vite manifest 產生，舊 app cache 會在 activate 清理。
- robots.txt、llms.txt 與 sitemap.xml 皆直接回傳 200；Lighthouse 的 robots／llms 失敗來自正式 connect-src 'none' 阻擋其頁內檢索器，因此保留隱私 CSP 並由 build verifier 檢查內容。
- npm audit --omit=dev 為 0 vulnerabilities；npm outdated 沒有列出落後 dependency。

## 自動驗證

- npm run verify：Node tests、TypeScript、Vite production build、static build verifier。
- Mapping：已知 BIG-5E／HKSCS 衝突、未知 bytes、完整 mapping round-trip、PUA recovery／unresolved cases。
- Data：CSV quoting／CRLF／literal values、Excel formatted values／formula cache、208-byte TXT／padding／final CRLF。
- Pipeline：日期、證號、性別、跨欄、空白列、TEL transformation、row inclusion、format-specific output gate。
- Batch／ZIP：Unicode Path、CP950／CP437 filename fallback、nested ZIP、symlink、unsafe path、collision、fail-closed output。
- UI contracts：tree aggregation、row filter、page-scoped bulk selection、focus continuity、ARIA references、responsive/static style rules。
- Production：CSP、agent discovery、offline manifest groups、no source maps、base／Excel JavaScript budgets。

## 剩餘風險

1. 接收端是否接受這份官方 BIG-5E profile、padding 與 CRLF 尚需核准的去識別 fixture 實測；本機 round-trip 不能替代外部系統 acceptance。
2. 大型 Excel／ZIP 仍在主執行緒處理；25 MiB／100 MiB 是安全上限，不代表已證明互動延遲可接受。
3. 部署 origin 的 service-worker 安裝、更新與完全離線 reload 尚需瀏覽器 smoke test。
4. Screen reader、forced-colors、reduced-motion 與完整鍵盤／觸控旅程需要人工或正式 browser automation 覆蓋。
5. 專案本身尚未選定 license；在此之前不應接受第三方 contribution。

後續工作與明確不做的相容範圍見 [ROADMAP.md](ROADMAP.md)，BIG-5E 來源與重建方式見 [BIG5E_MAPPING.md](BIG5E_MAPPING.md)。
