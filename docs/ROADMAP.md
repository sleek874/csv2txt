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
- 任何 active 檔案含無法解析記錄或檔案層級錯誤、零勾選列、fatal output issue、路徑碰撞，或 output preparation 尚未完成／失敗，都使整批輸出 fail closed；一般列 error／warning 與可安全替代的 encoding issue 不阻止下載。
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
- ZIP reader 限制巢狀深度、項目數、單檔／總展開量，拒絕 traversal、加密、symlink、ZIP64 與碰撞。
- Excel、ZIP 與預覽字型維持 manifest-derived lazy resource group；正式 CSP 保持 connect-src 'none'。
- 靜態 build verifier 持續檢查 semantic shell、ARIA reference、legacy residue、離線資源與 JavaScript budget。

## 發布前仍需確認

1. 由實際接收系統使用核准的去識別來源／輸出 pair，確認 BIG-5E bytes、padding、CRLF 與最後一筆 CRLF 均被接受。
2. 在部署 origin 完成 service-worker 安裝、optional resource 預備、離線 reload 與更新恢復 smoke test。
3. 以鍵盤、螢幕閱讀器、reduced-motion、forced-colors、深／淺色及真實窄螢幕走完整檔案、treegrid、問題 disclosure、分頁與下載流程。

## 下一階段

### UI 後續整理

- 資料預覽的欄寬在不同資料內容與 viewport 下仍不一致；下一次 UI pass 專門量測並統一欄寬策略，不在這次狀態轉場變更中混入 table sizing 行為。
- 資料預覽篩選保留原生 select 的開啟與收合，不建立瀏覽器不一致的自製選單動畫；選取後由共用 preview settle transition 平滑提交新內容。
- 以實際鍵盤、forced-colors 與已載入資料檢查 segmented tabs、preview 顯示／隱藏及共用 settle transition；reduced-motion 與窄螢幕 headless smoke 已完成，動畫不得改變固定資訊區、預覽或下載狀態的幾何。

### 輸出取消與 worker 排程

目前觀察：

- 建立下載期間移除檔案時，Section 1 會顯示等待訊息；移除命令已送出但在 worker 佇列等待。
- 新增檔案預期使用相同佇列邊界，尚未以實際操作確認。
- 列勾選框在主執行緒立即回應；同步輸出仍執行時，對應 worker 命令只會排隊。已觀察到舊生成完成後先開啟檔案儲存視窗，因此不能把 UI 回應視為 worker 已套用選取變更。
- Section 0／1 改變 dependency key 時，Section 2／3 必須丟棄舊結果；Section 2 的提示不得永久停用目前已符合下載條件的按鈕。

後續依量測選擇最小路線，不新增跨 section 的可變狀態：

1. 共用由格式、canonical active file IDs、既有 `selectionRevision` 與 Section 3 mapping 衍生的 request key，在儲存前拒絕過期結果。
2. 將 row materialization 與 advanced join 分段，在 worker event-loop yield 後檢查既有 revision，使排隊的勾選／移除命令可提早使舊工作停止；單次同步 serializer 仍只能在返回後丟棄結果。
3. 若實測證明 XLSX serializer 的不可中止區段過長，再評估每次輸出的短生命週期 worker；需先量測 IR snapshot 複製、記憶體峰值與離線 chunk 成本，不先建立第二份長期 IR。

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

## 不在目前範圍

- 使用者自訂 schema、任意 cell editor、部分成功檔案下載。
- 舊設定或舊 UI migration。
- Server processing、帳號、同步、telemetry 或 runtime CDN。
- 超過已驗證 ZIP／檔案資源上限的批次。
