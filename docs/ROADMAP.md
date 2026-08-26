# 離線資料轉換 — 更新計畫

## 維護原則

- Unicode 是唯一共用 IR；CSV、XLS、XLSX、BIG-5E TXT 與 ZIP 只在輸入／輸出邊界處理格式差異。
- 臺灣政府舊資料使用明確的 BIG-5E profile，不以 WHATWG Big5、HKSCS 或其他 vendor mapping 靜默 fallback。
- 不維護舊設定檔、方向式 UI、舊 DOM selector、舊 controller 或 schema migration 相容層。
- 每次變更都必須保留 byte／CRLF、ZIP 安全、隱私、可及性、離線資源與結構性 fail-closed batch output 契約；可解析的列 error／warning 仍預設勾選且不形成一般 gate。
- 只加入已確認用途的功能與 dependency；未確認用途不建立假控制。
- 重大更新只有在 `DESIGN.md` 的結果、範圍、invariants、允許變更與完成條件獲得確認後才排入；roadmap 只拆分可獨立運作與驗證的垂直切片，不預先建立未使用的基礎設施。

## 已完成的主要版本

### 固定資料與共用工作區

- 固定 15 欄、208-byte profile 是唯一規格來源。
- CSV、XLS、XLSX 與 BIG-5E TXT 進入相同的 normalization、來源驗證、明確 transformation、最終驗證與 row-selection 流程。
- Section 0 雙格式下拉、Section 1 active／other 分類、Section 2 固定輸出摘要、Section 3 進階輸出與流程後方規則 disclosure 已完成。
- 100 列分頁、點擊展開的全寬問題區、逐列輸出決策與目前篩選頁面的三態批次選取已完成。
- 多格式追加、XLS→XLSX family、ZIP entry 分類、來源／資料夾／檔案 treegrid、移除／復原、未讀狀態與 active-family 聚合已完成。

### 格式與批次輸出

- CSV、BIG-5E TXT 與 Spreadsheet 各自由同一 codec 擁有 parse／serialize；ZIP 是獨立 container codec。
- 單檔直接下載；多檔保留安全虛擬路徑並以臺北分鐘時間戳建立 ZIP。
- 任何實際輸出的 active 檔案含無法解析記錄或檔案層級錯誤、fatal output issue、路徑碰撞，或 output preparation 尚未完成／失敗，都使整批輸出 fail closed；零勾選檔案明確略過，一般列 error／warning 與可安全替代的 encoding issue 不阻止下載。
- CSV 輸出固定 UTF-8 BOM、CRLF、無標題列並保存 literal IR 值；需要可靠試算表文字型別時使用 XLSX。

### BIG-5E 與舊系統字元

- BIG-5E codec 使用數位發展部 CNS11643 20260505 固定來源與 SHA-256，執行時完全離線。
- 17,454 筆非 ASCII mapping 負責逐段 decode 與 output encode；所有已知 mapping 由測試逐筆 round-trip。decode 未知 segment 與 encode 未對照字元各自在邊界以全形 `？` 代替並保留診斷。
- 4,107 筆 recovery-only mapping 只還原官方資料可唯一收斂的 CP950 PUA；未對照或歧義值保留原 code point 並要求人工確認。
- BIG-5E 無 mapping 字元是非阻擋替代提醒；替代後 byte 寬度才是 TXT output gate。兩者都不改寫共用 Unicode IR，也不限制 CSV／XLSX 表示能力。

### UI、離線與安全

- Section 1 treegrid 呈現空白列、無法解析、資料、正確、錯誤、警告、已選列與目前格式輸出問題；Section 2 只保留所選格式摘要、下載狀態與下載動作。
- Sections 2／3 的操作卡共用狀態、檔案／列摘要、固定 action rail 與預設收合的問題 disclosure；展開內容不重新置中桌面按鈕。
- 未還原 PUA 與預計替代的位置在預覽以 `■` 顯示，code point 留在展開問題區；原始 PUA 仍由 IR 保存。BIG-5E 輸入的無對照 byte segment 在 IR 以 `？` 代替並在預覽該位置顯示 `■`，其餘可解碼內容保留。技術代碼與 byte 證據只在 disclosure 顯示。
- 使用者選取的來源與參照 Excel、ZIP 內每個 entry 都採 100 MiB 單檔上限；ZIP reader 另限制巢狀深度與項目數，逐項丟棄並記錄 traversal、加密、symlink 與碰撞，整體拒絕 ZIP64、分割式／不可驗證結構及超額累計項目，不限制累計輸入大小。
- Section 2 的 ZIP 最多 5,000 個 100 MiB entries、最終 500 MiB；先 preflight，再依所選格式逐檔 level-6 deflate 或 XLSX store、yield 並合作取消。零勾選檔案明確略過，不阻擋其他輸出。
- Excel、ZIP 與預覽字型維持 lazy execution，但由 manifest-derived `release.json` 在 release staging 時一併下載；正式 CSP 保持 connect-src 'none'。
- 靜態 build verifier 持續檢查 semantic shell、ARIA reference、legacy residue、hashed boot、release graph／shell digest、service-worker staging／retention 與 JavaScript budget。

## 發布前仍需確認

1. 由實際接收系統使用核准的去識別來源／輸出 pair，確認 BIG-5E bytes、padding、CRLF 與最後一筆 CRLF 均被接受。
2. 在部署 origin 完成 service-worker 首次安裝、app release staging、worker implementation update、同一 release model 內的舊 tab asset 相容、離線 reload 與更新失敗回復 smoke test。
3. 以鍵盤、螢幕閱讀器、reduced-motion、forced-colors、深／淺色及真實窄螢幕走完整檔案、treegrid、問題 disclosure、分頁與下載流程。

## 下一階段

### UI 後續整理

- 資料預覽的欄寬在不同資料內容與 viewport 下仍不一致；下一次 UI pass 專門量測並統一欄寬策略，不在這次狀態轉場變更中混入 table sizing 行為。
- 資料預覽篩選保留原生 select 的開啟與收合，不建立瀏覽器不一致的自製選單動畫；選取後由共用 preview settle transition 平滑提交新內容。
- 以實際鍵盤、forced-colors 與已載入資料檢查 segmented tabs、preview 顯示／隱藏及共用 settle transition；reduced-motion 與窄螢幕 headless smoke 已完成，動畫不得改變固定資訊區、預覽或下載狀態的幾何。

### 輸出取消與 worker 排程

Section 2 已完成：

- 以格式、canonical active file IDs 與 `selectionRevision` 衍生 request key；資料變更時不儲存過期結果。
- ZIP 逐檔 materialize、加入、釋放、yield 並檢查 generation token；「取消下載」不保存部分結果。
- 單一同步 serializer，尤其 SheetJS workbook，仍只能在返回後停止；同一 worker 中排隊的勾選、移除或新增命令也要等目前同步區段結束。

後續只依瀏覽器量測選擇最小路線：

1. 以大型 CSV／TXT／XLSX 與接近 500 MiB 的 ZIP 實測取消延遲、峰值記憶體及下載完成行為，並另記錄低記憶體裝置結果。
2. 若 row materialization 或 Section 3 join 是主要等待來源，再分段 yield 並檢查既有 revision；Section 3 目前仍只有過期結果拒絕，沒有獨立取消按鈕。
3. 只有 SheetJS 的不可中止區段實測過長時，才評估每次輸出的短生命週期 worker；需先量測 IR snapshot 複製、峰值記憶體與離線 chunk 成本。

### Decoder 與來源診斷

- 將 ASCII／推測 UTF-16 等低可信 decoder 結果轉成可見的檔案 issue。
- 補足副檔名與容器內容不一致的直接測試與可採取行動的繁中訊息。
- 不加入手動 encoding selector，也不因診斷功能恢復來源格式專用流程。

### 進階 XLSX

Section 3 已完成：

- Reference workbook 是 Section 3 專用的單一 XLS／XLSX，不加入 Section 1 tree。
- Lookup 只讀所有勾選列的 final value，不回寫標準 pipeline。
- 使用者選擇 worksheet、reference key 與要加入的欄位；primary 欄位11以 trim＋大寫比對。
- 第一次使用不預選附加欄位；之後以本機 salt 加 SHA-256 header fingerprints 還原相同欄位，不保存 header、檔名或工作表名稱。
- Primary duplicates 逐列保留；reference duplicates 展開為多筆；未命中保留原列並填入空白參照值。這些資料 issue 不阻止下載或 Section 2 標準輸出。
- 結果以解析後文字值輸出為單一 `進階輸出-YYYYMMDDHHmm.xlsx`，不保留公式、不打包 ZIP。

後續候選（尚未排入實作）：

- 先解決大型 join rows、worksheet 與完整 XLSX bytes 同時 materialize 的限制；候選方向須能逐列建立工作表 XML、增量封裝 XLSX ZIP 並以有界 chunks 直接輸出，且先證明既有 bytes／儲存格／順序 parity、取消邊界與瀏覽器峰值記憶體。
- 只有上述大型 XLSX 路徑完成後，才評估以「另存新檔」取得使用者選定的 writable，將增量輸出直接寫入暫存檔並在失敗、取消或 revision 變更時 abort。現階段把已完整建立的 Blob 改寫入 Save As 只改變目的地與權限 UX，不降低主要峰值記憶體，因此不先加入 picker、磁碟快取或可重複下載連結。

## 不在目前範圍

- 使用者自訂 schema、任意 cell editor、部分成功檔案下載。
- 舊設定或舊 UI migration。
- Server processing、帳號、同步、telemetry 或 runtime CDN。
- 超過已驗證 ZIP／檔案資源上限的批次。
