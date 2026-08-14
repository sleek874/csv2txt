# 站點健康檢查

檢查日期：2026-08-14
範圍：格式分流、來源證據、共同資料管線、CSV／XLSX／TXT／ZIP I/O、工作區 UI 契約、離線建置、安全、dependency、測試與文件。

## 結論

目前分支的 Node tests、TypeScript、正式建置、static build verifier、桌面 headless Chrome smoke 與 Lighthouse 已通過。Headless smoke 涵蓋啟動解除鎖定、主題切換、檔案分類 tabs、規則 disclosure、格式切換、合成 CSV 載入、預覽與下載就緒；不把這些結果延伸宣稱為螢幕閱讀器、原生 picker、下載對話框或真實裝置證據。

CSV serializer 使用標準 literal-value 輸出，固定 UTF-8 BOM、CRLF、無標題列並保存最終 IR；需要可靠的試算表文字型別與前置零時使用 XLSX。

## 目前架構

File／ZIP 先依 `TXT`／`CSV`／`XLSX` family 分類；只有目前輸入 family 經 format adapter、normalized Unicode IR、來源驗證、可稽核 transformation、最終驗證與 row selection，再通過獨立輸出格式的 gate。其他格式仍保留，ZIP 只負責安全容器路徑。

- 固定 profile、IR、validation、transformation、output validation 與 serializer 分層；瀏覽器 view 不持有 domain rule。
- workspace-model.ts 只保存跨區共用的輸入 family、檔案摘要、選取列與輸出格式。Section 1 操作、Section 2 輸出檢查／建立下載、Section 3 參照／join／建立下載各由自己的 controller 管理，不把 loading 或 error 複製進共享 snapshot。
- CSV／BIG-5E TXT 是 base codec；Spreadsheet、ZIP 與預覽字型依需求延遲載入並加入對應離線資源群組。

## BIG-5E 與資料完整性

- Runtime mapping 來自數位發展部 CNS11643 MapingTables.zip 版本 20260505，以 SHA-256 固定並產生 17,454 筆非 ASCII 一對一 mapping。
- Codec 不呼叫 WHATWG Big5／HKSCS fallback。衝突位置例如 964F、9BBC 依 BIG-5E 解讀。
- 測試逐一枚舉所有 runtime BIG-5E code，確認 decode／encode round-trip 與 provenance entry count 相符。
- Recovery table 含 4,107 筆官方資料可唯一收斂的 BMP PUA；測試確認輸出皆為 formal Unicode。
- 未解決 PUA 不猜字義、不消失、不被通用 replacement 取代；預覽只遮罩 glyph，IR 與問題明細保留 code point。
- BIG-5E 無對照字元在 TXT 逐字以全形 `？` 代替，不阻止下載；只有替代後 byte overflow 阻止 TXT。CSV／XLSX 保留 Unicode，未解決 PUA 也不改寫。

## UI 與可及性

- Section 0 使用兩個原生 dropdown，畫面只顯示 `TXT`、`CSV`、`XLSX`；XLS 歸入 XLSX。Section 1 將目前格式與其他檔案分開，treegrid 顯示空白列、無法解析、資料、正確、錯誤、警告、已選與 output issue。
- 可解析的 error／warning 列預設勾選且不形成一般 gate；無法解析列保存原始證據、不可勾選並形成結構性 gate。
- 100-row preview 不另設問題欄，由狀態儲存格展開該筆全寬說明，初始保持收合。未還原 PUA 的可見值固定使用 `■`，code point 保持可見，技術資訊另行展開。
- Section 2 不再選格式，只顯示 Section 0 選擇與下載狀態；Section 3 維持既有 minimal lookup contract，欄位規則移到流程後方。
- 移除與清空 copy 明確表示只影響頁面記憶體；ZIP 內 symlink 在該次新增結果歸為「捷徑」，不保存於工作區。
- 預覽已移除 hover tooltip；狀態儲存格是唯一可用鍵盤操作的 disclosure 控制。大量 table body 不作為 live region，只有事件型狀態使用安靜的 polite announcement。固定 table viewport、spinner slot、摘要高度與 stable scrollbar 降低內容切換位移，按鈕不再用位移式 active 效果。
- 格式摘要、資訊／錯誤提示、預覽與 Sections 2／3 的狀態使用同一個短暫 settle primitive；只在語意狀態改變時淡入，不先淡出、不改變幾何，並遵守 reduced-motion。首次預覽與失敗狀態保留固定區域，輸出準備失敗會停止 spinner 而不再卡在 loading。
- 檔案處理狀態移到固定資訊區後，窄螢幕的靜態 picker 不再保留舊版 4.5rem loading 文字槽；處理中的幾何穩定改由資訊區單一負責。
- Section 3 參照欄位操作在讀取 workbook、重算結果或建立下載時會鎖定，避免平行堆疊昂貴 join 或工作表切換；Excel 讀取提醒按類型合併為有界、白話的摘要。
- Section 2 建立下載期間若切換 Section 0 輸入格式，舊輸出會捨棄並顯示重新下載提示；提示會依目前 output plan 恢復按鈕，不再沿用舊 generation 的 disabled 狀態。

自動與 headless 證據不能取代螢幕閱讀器、完整鍵盤操作、原生 file picker、下載 dialog 或真實裝置測試；這些仍列為發布前人工檢查。

## 安全、隱私與離線

- 正式 CSP 保持 connect-src 'none'；沒有 upload endpoint、telemetry、runtime CDN 或第三方連線。
- 檔案內容、路徑、issue、IR 與輸出不寫入 localStorage、IndexedDB、URL 或 log；localStorage 只保存 UI theme，以及 Section 3 的本機 salt 與 header SHA-256 fingerprints，不保存可讀 header、檔名或工作表名稱。
- ZIP 在解壓前檢查中央目錄，限制 entry、深度、單檔／總大小，拒絕 traversal、控制字元、加密、symlink、ZIP64、未知 compression 與碰撞；實際串流解壓大小也另行計數。
- Service worker 的 base、Excel、archive 與 font 群組由 Vite manifest 產生，舊 app cache 會在 activate 清理。
- robots.txt、llms.txt 與 sitemap.xml 由正式建置提供；本次 Lighthouse 的 robots fetch 失敗來自 `connect-src 'none'` 阻擋其頁內檢索器，因此保留隱私 CSP 並由 build verifier 檢查內容。

## 本次驗證

- `npm run verify`：20 個 Node test files、TypeScript、Vite production build、static build verifier。
- Mapping：已知 BIG-5E／HKSCS 衝突、未知 bytes、完整 mapping round-trip、PUA recovery／unresolved cases。
- Data：CSV quoting／CRLF／literal values、Excel formatted values／formula cache、208-byte TXT／padding／final CRLF。
- Pipeline：日期、證號、性別、問號 warning、跨欄、空白列、rejected evidence、TEL transformation、row inclusion、format-specific output gate。
- Batch／ZIP：Unicode Path、CP950／CP437 filename fallback、nested ZIP、symlink、unsafe path、collision、fail-closed output，以及 51 個 BIG-5E TXT／306,051 列極限 fixture 的 entry、expanded bytes、CRLF 與抽樣 parser 契約。
- UI contracts：雙格式分類、tree aggregation、rejected filter、page-scoped bulk selection、ARIA references、responsive/static style rules。
- Output state：Node 回歸測試與 Chrome smoke 都涵蓋建立下載期間切換輸入 family，確認舊檔不儲存、提示出現、spinner 停止，且目前有效下載按鈕恢復可用。
- Production：CSP、agent discovery、offline manifest groups、no source maps、base／Excel JavaScript budgets。
- Chrome 151、1280×900：使用隔離 profile 對 `http://127.0.0.1:4174/` 執行 DOM／互動 smoke，載入合成 fixture 後沒有 console warning 或 exception。
- Lighthouse 13.4.1：Performance 100、Accessibility 100、Best Practices 100、SEO 92。SEO 扣分來自 Lighthouse 在 `connect-src 'none'` 下無法以頁內檢索器抓取 robots.txt；檔案本身由 build verifier 驗證，未為分數放寬 CSP。

## 剩餘風險

1. 接收端是否接受這份官方 BIG-5E profile、padding 與 CRLF 尚需核准的去識別 fixture 實測；本機 round-trip 不能替代外部系統 acceptance。
2. 大型 Excel／ZIP 已移入 dedicated worker；極限 ZIP fixture 的自動測試仍只證明解壓與資料契約，不證明 306,051 列的端到端耗時或記憶體可接受。25 MiB／100 MiB 是安全上限，不是效能保證。
3. 部署 origin 的 service-worker 安裝、更新與完全離線 reload 尚需瀏覽器 smoke test。
4. Lighthouse 與本次 headless smoke 不等於 screen reader、forced-colors、reduced-motion、原生 picker、下載對話框或完整鍵盤／觸控旅程；這些仍需人工或正式 browser automation 覆蓋。
5. 專案本身尚未選定 license；在此之前不應接受第三方 contribution。

後續工作與明確不做的相容範圍見 [ROADMAP.md](ROADMAP.md)，BIG-5E 來源與重建方式見 [BIG5E_MAPPING.md](BIG5E_MAPPING.md)。
