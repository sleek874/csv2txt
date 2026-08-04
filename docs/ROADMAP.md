# 離線資料轉換 — 更新計畫

## 維護原則

- Unicode 是唯一共用 IR；CSV、XLS、XLSX、BIG-5E TXT 與 ZIP 只在輸入／輸出邊界處理格式差異。
- 臺灣政府舊資料使用明確的 BIG-5E profile，不以 WHATWG Big5、HKSCS 或其他 vendor mapping 靜默 fallback。
- 不維護舊設定檔、方向式 UI、舊 DOM selector、舊 controller 或 schema migration 相容層。
- 每次變更都必須保留 byte／CRLF、ZIP 安全、隱私、可及性、離線資源與 fail-closed batch output 契約。
- 只加入已確認用途的功能與 dependency；未確認用途不建立假控制。

## 已完成的主要版本

### 固定資料與共用工作區

- 固定 15 欄、208-byte profile 是唯一規格來源。
- CSV、XLS、XLSX 與 BIG-5E TXT 進入相同的 normalization、來源驗證、明確 transformation、最終驗證與 row-selection 流程。
- 四區 UI、100 列分頁、問題篩選、逐列輸出決策與目前篩選頁面的三態批次選取已完成。
- 多檔追加、來源／資料夾／檔案 treegrid、移除／復原、未讀狀態與完整工作區聚合已完成。

### 格式與批次輸出

- CSV、BIG-5E TXT 與 Spreadsheet 各自由同一 codec 擁有 parse／serialize；ZIP 是獨立 container codec。
- 單檔直接下載；多檔保留安全虛擬路徑並以臺北分鐘時間戳建立 ZIP。
- 任何處理中／失敗檔案、檔案層級錯誤、零勾選列、output issue 或路徑碰撞都使整批輸出 fail closed。
- CSV 輸出固定 UTF-8 BOM、CRLF、無標題列並保存 literal IR 值；需要可靠試算表文字型別時使用 XLSX。

### BIG-5E 與舊系統字元

- BIG-5E codec 使用數位發展部 CNS11643 20260505 固定來源與 SHA-256，執行時完全離線。
- 17,454 筆非 ASCII mapping 同時負責嚴格 decode／encode；所有 mapping 由測試逐筆 round-trip。
- 4,107 筆 recovery-only mapping 只還原官方資料可唯一收斂的 CP950 PUA；未對照或歧義值保留原 code point 並要求人工確認。
- BIG-5E mapping 與 byte 寬度是所選格式的 output gate，不改寫共用 Unicode IR，也不限制 CSV／XLSX 表示能力。

### UI、離線與安全

- Section 1 以單一 treegrid 呈現資料、正確、錯誤、警告、已選列與目前格式輸出問題；Section 2 只保留格式、下載狀態與下載動作。
- ZIP reader 限制巢狀深度、項目數、單檔／總展開量，拒絕 traversal、加密、symlink、ZIP64 與碰撞。
- Excel、ZIP 與預覽字型維持 manifest-derived lazy resource group；正式 CSP 保持 connect-src 'none'。
- 靜態 build verifier 持續檢查 semantic shell、ARIA reference、legacy residue、離線資源與 JavaScript budget。

## 發布前仍需確認

1. 由實際接收系統使用核准的去識別來源／輸出 pair，確認 BIG-5E bytes、padding、CRLF 與最後一筆 CRLF 均被接受。
2. 在部署 origin 完成 service-worker 安裝、optional resource 預備、離線 reload 與更新恢復 smoke test。
3. 以鍵盤、螢幕閱讀器、reduced-motion、forced-colors、深／淺色及真實窄螢幕走完整檔案、treegrid、tooltip、分頁與下載流程。

## 下一階段

### 效能與 worker

- 先量測 250、1,200、6,000 列與接近 25 MiB 上限的代表性 CSV／XLS／XLSX／ZIP。
- 只有在量測顯示主執行緒阻塞時，才將 archive、Excel、validation 與 serialization 移入單一有界 worker。
- Worker 必須支援取消、stale-result 防護與可驗證的記憶體釋放；UI 只取得摘要及目前頁面。

### Decoder 與來源診斷

- 將 ASCII／推測 UTF-16 等低可信 decoder 結果轉成可見的檔案 issue。
- 補足副檔名與容器內容不一致的直接測試與可採取行動的繁中訊息。
- 不加入手動 encoding selector，也不因診斷功能恢復來源格式專用流程。

### 進階 XLSX

Section 3 已完成：

- Reference workbook 是 Section 3 專用的單一 XLS／XLSX，不加入 Section 1 tree。
- Lookup 只讀所有勾選列的 final value，不回寫標準 pipeline。
- 使用者選擇 worksheet、reference key 與要加入的欄位；primary 欄位11以 trim＋大寫比對。
- Primary duplicates 逐列保留；reference duplicates 展開為多筆；未命中保留原列並填入空白參照值。這些資料 issue 不阻止下載或 Section 2 標準輸出。
- 結果以解析後文字值輸出為單一 `進階輸出-YYYYMMDDHHmm.xlsx`，不保留公式、不打包 ZIP。

## 不在目前範圍

- 使用者自訂 schema、任意 cell editor、部分成功檔案下載。
- 舊設定或舊 UI migration。
- Server processing、帳號、同步、telemetry 或 runtime CDN。
- 超過已驗證 ZIP／檔案資源上限的批次。
