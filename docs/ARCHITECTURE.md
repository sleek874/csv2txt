# 離線資料轉換 — 架構與資源責任

## 1. 架構目標

目前架構保留已驗證的靜態頁面、離線、視覺與檔案轉換骨架，不延伸已移除的 settings-first controller。共用內部表示是唯一工作區，讓所有輸入格式、批次 ZIP、驗證、自動修正、預覽與三種輸出共用同一條可測試資料管線。

專案通用的簡潔實作、clean-code 與 coding-agent 協作原則由 [貢獻指南](../CONTRIBUTING.md) 統一說明；本文件只定義架構責任與資料契約。

原則：

- Core 不接觸 DOM、File picker、下載或 live region。
- Input adapter 只解析，不執行隱藏的業務修正。
- Validation 不直接產生 bytes 或 workbook。
- Modification 必須留下 before/after 與 reason。
- Serializer 只接受已勾選且通過所選 codec output gate 的內部資料。
- Main entry 只負責組裝，不累積業務條件。
- 模組以清楚責任為主，不建立大量只有一個 trivial function 的檔案。

### 重大更新的架構決策

- 先依 `DESIGN.md` 的已確認契約提出責任邊界與資料流，再修改模組。
- 優先延伸現有 owner、平台能力與 dependency；新增 layer、configuration、
  package 或平行 state 前，必須指出現有結構無法承擔的具體原因。
- 以最小可運作的垂直切片落地，每個切片都維持目前產品可建置、可測試、
  可使用；不得以未接線的抽象、空殼或暫時雙軌取代工作中的流程。
- 行為由新契約取代時，同一變更移除 obsolete implementation、compatibility
  path、tests 與文件。不得保留預計稍後再移除的 stopgap。
- 架構宣稱必須以 source、dependency 官方文件／types 或量測為依據；推論與
  尚未驗證的假設要明確標示。

## 2. 目標資料流

```text
File / ZIP
  -> inventory and safe virtual paths
  -> source-family classification (TXT / CSV / XLSX)
  -> active-family selector; other files remain stored
  -> automatic decoder selection
  -> kept-file filter
  -> input adapter
  -> normalized internal representation
  -> source validation
  -> explicit filters and modifications
  -> final validation
  -> independently selected output format
  -> selected-format output validation
  -> selected output adapter
  -> safe output paths
  -> ZIP writer

Optional advanced branch
  final validated internal representation
    + separately selected reference workbook
  -> explicit lookup plan
  -> lookup result and issues
  -> organized XLSX adapter
```

解析器、validator、modifier 與 serializer 之間只交換明確型別，不共享可變 DOM state。

## 3. 共用內部表示

建議型別方向：

```ts
type OutputFormat = "big5-txt" | "csv" | "xlsx";
type Severity = "error" | "warning";

interface InternalFile {
  blankSourceRows: number[];
  id: string;
  virtualPath: string;
  rows: InternalRow[];
  rejectedRecords: RejectedSourceRecord[];
  summary: FileSummary;
}

interface BatchState {
  inventory: BatchNode[];
  files: InternalFile[];
  inputFormat: "txt" | "csv" | "xlsx";
  outputFormat: OutputFormat;
}

interface InternalRow {
  sourceRow: number;
  included: boolean;
  cells: InternalCell[];
  issues: ValidationIssue[];
  changes: TransformationChange[];
}

interface InternalCell {
  fieldIndex: number;
  normalizedValue: string;
  sourceValue?: string;
  finalValue?: string;
  issues: ValidationIssue[];
}
```

實際實作可依 profiling 調整儲存方式，但需維持：

- `normalizedValue` 是主要資料。
- 來源 family 與 decoder metadata 屬於 inventory／orchestration，不進入 logical IR；`.xls` 與 `.xlsx` 共用 `xlsx` family，ZIP 沒有 family。
- `inputFormat` 決定 active files，`outputFormat` 決定 serializer；兩者獨立且都不存入每列或 cell。
- `included` 是每列的輸出決策：所有進入共同 IR 的資料列一律預設為 `true`，不受 error、warning 或自動修正影響，之後只由預覽中的使用者操作改變。
- 原值只有在不同、發生 issue 或需說明修改時保存。
- 無法解析的 record 保存原始證據與原因；成功解析的 raw record 釋放，不維護三份完整資料。
- Final value 採 copy-on-write，沒有修改就不重複字串。
- UI 只取得摘要及目前 100-row page。
- 原始 bytes 在不再需要後可釋放。
- 內部表示不持久化。

## 4. 責任區分

| 區域 | 責任 | 不應負責 |
|---|---|---|
| Fixed profile | 欄寬、regex、hook metadata、固定 modifier 宣告 | DOM、檔案讀取、ZIP |
| Input adapters | CSV、Excel、BIG-5E TXT 解析為 logical rows | 補 TEL、下載、UI issue render |
| Normalization | 移除空白、空白列計數、ID 大寫、來源列號 | 最終 byte padding |
| Validation | 欄位、日期、checksum、跨欄、severity | 直接修改值 |
| Transformations | 明確列篩選、有效證號推導性別、TEL 補值、舊系統字元還原與 change log | 無紀錄地修正值、猜測未對照字元 |
| Output validation | 所選格式的替代位置、替代後 byte 寬度與 blocking output issues | 改寫 primary IR、把 codec 限制當來源錯誤 |
| Output adapters | BIG-5E TXT bytes、UTF-8 CSV、XLSX workbook | Parser fallback、UI state |
| Advanced lookup | 勾選列投影、參照 workbook、逐列 left join、整理後 workbook model | 改寫 primary IR、因資料 issue／重複／未命中阻擋下載 |
| Archive | ZIP inventory、quota、安全路徑、ZIP output | 欄位規則 |
| Batch orchestration | Queue、取消、格式分類、active-family selector、狀態聚合與整批輸出選擇 | Validator 細節、DOM markup |
| Views | 雙格式選擇、selected-format／other tabs、共用清單 table shell、tree、summary、100-row page、問題 disclosure | 解析、checksum、ZIP 解壓 |
| Browser integration | File picker、download、unload guard、theme | Domain 規則 |

## 5. 模組輪廓

格式 I/O、容器 I/O、資源生命週期與各 section UI 明確分層。只建立已有實際使用者的模組；尚未確認的 worker 不建立空殼。

```text
src/
  core/
    formats/
      types.ts
      csv.ts
      big5-txt.ts
      spreadsheet.ts
    archive/
      types.ts
      policy.ts
      zip.ts
    advanced/
      lookup.ts
    fixed-profile.ts
    internal-model.ts
    conversion-pipeline.ts
    normalization.ts
    validation.ts
    transformations.ts
    encoding.ts
    big5e-mapping.ts
    private-use-recovery.ts
    private-use-recovery-mapping.ts
    output-validation.ts
    bytes.ts
    file-formats.ts
  app/
    state/
      workspace-model.ts
      workspace-selectors.ts
      workspace-types.ts
    sections/
      format/format-controller.ts
      format/format-view.ts
      rules/rules-view.ts
      input/input-controller.ts
      input/input-section-view.ts
      input/file-picker-view.ts
      input/file-table-view.ts
      input/file-tree-view.ts
      input/data-preview-view.ts
      input/other-files-view.ts
      output/output-controller.ts
      output/output-view.ts
      output/output-presentations.ts
      advanced/advanced-controller.ts
      advanced/advanced-view.ts
    adapters/
      input-adapter.ts
      output-adapter.ts
      advanced-output-adapter.ts
    resources/
      codec-manager.ts
      resource-policy.ts
    shell/
      app-status.ts
      readiness-view.ts
      status-indicator.ts
  browser/
    dom.ts
    download.ts
    offline-cache.ts
    theme.ts
    unload-guard.ts
```

CSV、BIG-5E TXT 與 Spreadsheet 是三個 tabular codec，各自擁有 parse 與 serialize。ZIP 是 container codec，交換 archive entries 而非 logical rows，因此放在 `core/archive/`，也不成為格式選項。格式分類與 active／other 投影集中在 `file-formats.ts` 及 `workspace-selectors.ts`，controller 與 view 不各自重寫副檔名規則。

`src/main.ts` 只建立共享 model、resource manager、controllers 與 views，並連接頂層生命週期。每個 view 只查詢自己 section root 內的元素；跨 section 的輸入 family、列納入決策與整批輸出格式由 `workspace-model.ts` 保存。Section 1 的互斥 row outcome 與 Section 2 的 download problem 都由 active snapshot 即時計算，不建立第二套 summary state；頁碼、篩選、tabs 與 disclosure 等純呈現狀態留在各 view。`file-table-view.ts` 只提供 selected-format 與 other 清單共用的 spacer／empty row 及 footer 更新，不擁有分類、tree 或狀態文案。

Section 3 是沒有 error、warning 或 validation gate 的 minimal working model。`core/advanced/lookup.ts` 只負責勾選列投影（包括欄位8的 `1 → 男`、`2 → 女` mapping）與純資料 join；controller 保存 reference workbook、worksheet、key 與欄位選擇，view 只處理獨立 picker、mapping controls、摘要與下載。Reference duplicate 以 one-to-many 結果展開，未命中以空白參照值保留原列，兩者都不是 blocking issue。

## 6. Batch state

Batch node 至少包含：

- 穩定 ID。
- Safe virtual path。
- Node kind：folder、archive、regular file、symlink、unsupported。
- Include/exclude state。
- Waiting、processing、valid、warning、error 狀態。
- Decoder metadata。
- Blank/rejected/data/correct/error/warning/selected/output-problem counts。
- Output path 或 collision issue。

資料夾與 ZIP 僅聚合子節點狀態。UI 不自行重新推導 conversion correctness。

一般 UI 只固定顯示 `TXT`、`CSV`、`XLSX` family，不顯示 decoder 或技術堆疊；只有問題需要診斷時才在「查看技術資訊」揭露必要證據。

Batch cancellation 使用 generation/token 或 worker termination，舊工作不得覆蓋新批次。

## 7. Worker 邊界

ZIP、Excel、大型 CSV、驗證與 ZIP 輸出應逐步移到 dedicated worker。Main thread 只保留：

- Tree summary。
- Selected file ID。
- Requested page/filter。
- Download readiness。
- Batch output format。
- Concise application status。

Worker 保存 active batch 的內部表示，並以 request/response API 提供最多 100 rows。開始實作 worker 前先定義 protocol 及 cancellation；不在多個 UI module 各自建立 worker。

第一個 worker 版本採有界、近似序列的重型工作，先控制記憶體與結果順序；只有 profiling 證明有益時才提高 concurrency。

## 8. Resource reuse

### Base shell

保留 `bootstrap.ts`、靜態 `index.html`、主視覺 token、theme、CSP、unload guard 與基本 CSV path。首屏不得因 ZIP 或 Excel 能力變重。

### Excel

由 `src/app/resources/codec-manager.ts` 保存單一 memoized spreadsheet codec promise 與 Excel manual chunk：

- Inventory 或 parser 遇到 XLS/XLSX input 時載入 Excel。
- CSV 或 BIG-5E TXT input 本身不載入 Excel。
- 使用者選擇 XLSX output、實際需要建立 workbook 時載入 Excel。
- Section 3 讀取 reference workbook 與產生 organized XLSX 時重用同一個 spreadsheet codec；Section 3 不直接 import SheetJS，也不建立第二套 Excel dependency。
- Batch 中多個檔案共用同一個 module promise。

`spreadsheet.ts` 提供 generic workbook inspection/read/write 能力，以及 standard 15-column workflow 的 convenience functions。Section 3 重用前者，但 lookup、mapping 與 organized workbook model 仍屬於 `core/advanced/`，不得塞入 codec。

### ZIP

ZIP library 採獨立 lazy chunk，由 `codec-manager` 載入 `core/archive/zip.ts`：

- Inventory 發現 ZIP 時載入 reader。
- 只有準備下載時載入 writer 路徑。
- 不在 UI component 直接 import ZIP dependency。
- 解壓時使用 stream/filter/quota，不使用無界 `unzipSync` 處理整批內容。
- `zip.ts` 同時提供安全 extract 與 serialize；path、depth、quota、symlink 與 collision 規則放在相鄰 policy 模組。
- Standard output 只有一個檔案時直接回傳 tabular codec artifact；兩個以上才載入 ZIP writer，保留 virtual path，並以 output codec 與台北分鐘時間戳命名 archive。

### CSV 與 BIG-5E

- CSV codec 負責自動文字解碼、CSV parse，以及 UTF-8 BOM／CRLF／無標題列的 literal-value CSV serialize。它保存最終 IR 值，不加入公式、apostrophe 或試算表專用 wrapper；需要可靠儲存格文字型別時使用 XLSX。
- BIG-5E TXT codec 只使用本機固定的臺灣政府對照表，負責 208-byte records、padding 與 CRLF 的雙向 I/O；不得呼叫 WHATWG／HKSCS decoder 作為 fallback。輸入欄位逐段解碼，無對照 byte segment 在 Unicode IR 以 `？` 代替並保留最小 byte 證據，前後有效內容不丟棄；record 寬度或換行結構錯誤才拒絕整列。`■` 只由 preview 依替代位置顯示。
- `big5e-mapping.ts` 由 `scripts/generate-big5e-mapping.mjs` 從官方 CNS11643 對照表產生，組合 BIG5-2003 主表、符號、七個倚天外字與 BIG-5E，固定來源版本、SHA-256、筆數及一對一 byte／Unicode 關係。它只服務 BIG-5E input/output codec。
- 同一產生器另建立 compact `private-use-recovery-mapping.ts`。它使用完整 CNS／Unicode 與官方 legacy code tables，將 CP950 PUA 位置收斂為唯一 formal Unicode；有歧義或沒有對照時不產生 recovery entry。
- CSV／Spreadsheet IR 中的舊式 PUA 由 transformation 查詢 recovery-only table；成功留下 before／after change 與簡短 verification warning，未解決則保留原 code point 並產生簡短 error。CSV／XLSX 照原值輸出；選擇 TXT 時，未解決 PUA 與其他無 BIG-5E mapping 的 Unicode 都在輸出邊界以 `？` 代替。
- `output-validation.ts` 依 Section 2 選定格式檢查目前勾選列，結果由 Section 1 preview 與 Section 2 摘要呈現。無 BIG-5E mapping 是非阻擋替代提醒，提供檔案、來源列、欄位、替代位置及 code point；只有替代後仍超過固定欄寬才是 blocking output issue 並計入 tree table 問題數。CSV／XLSX 不套用 BIG-5E gate，output issues 也不寫回 IR。
- 三個 tabular codecs 都由 resource manager 暴露一致的 prepare/get 生命週期，但不強迫採相同載入時機。CSV 很小且是常見路徑；Spreadsheet 維持 on-demand heavy chunk。

### Preview font

保留 preview font 的延遲載入與離線重用。只有選取需要 fixed-width preview 的檔案時提高優先序；Tree 與一般 UI 不等待字型。

### Offline cache

Vite manifest 繼續是 resource graph 的唯一來源。Service worker group 預計為：

- Base shell。
- Excel chunk。
- ZIP chunk。
- Worker chunk。
- Preview font。

Build verifier 必須確認 manifest 與 group 一致、沒有遺漏 dynamic asset，且 base budget 不包含 Excel、ZIP 或 font。

## 9. Dependency policy

新增 runtime dependency 前必須符合：

- 可在瀏覽器與 ESM 使用。
- 能被 Vite 靜態分析並本機打包，不依賴 runtime CDN。
- 不需要未審查的 install script。
- License 可重新散布並記錄於 third-party notices。
- API 支援取消、stream/filter 或能置於 worker。
- 不重複現有 Papa Parse、SheetJS、iconv-lite 或平台能力。
- 能以 lazy chunk 隔離，不擴大 base shell。
- 有針對惡意輸入、資源上限與錯誤路徑的測試策略。

未被目前功能使用的 dependency 不先加入。任何新 dependency 必須與第一個實際使用者、測試、離線資源分類及 third-party notice 一起提交。

## 10. Fresh-start policy

目前版本不提供：

- Settings v3 parser 或 migration。
- 舊 settings JSON upload/download。
- 舊 localStorage 值轉換。
- 舊 DOM selector compatibility shim。
- 方向 tabs、方向狀態或正向／反向舊用語 alias。

舊 controller、markup、types、tests 與 static verifier assertions 已由新契約取代；不要恢復第二條 code path。

## 11. Styles and accessibility

保留現有全域 palette、spacing、border、shadow、responsive-grid、light/dark、reduced-motion 與穩定 layout 基礎。新增 UI 優先組合既有 token；只有跨兩個以上新 component 的共用模式才建立新 primitive。

責任建議：

- Foundation：tokens、reset、通用 layout、controls。
- Format selection：兩個原生 dropdown、固定摘要高度與一致的三個可見 label。
- Rules disclosure：流程後方初始收合的固定 profile 與 regex 參考。
- Batch inventory：treegrid hierarchy、node state、selection、unread／ignored badge 與 subtree aggregation。
- File table shell：selected-format 與 other 清單共用固定 viewport、sticky header／footer／檔名欄、完整高度 empty row、移除控制與既有 site tokens；分頁 view 只提供各自欄位與列內容。
- Data page：15-column table、互斥 row outcome、預設收合的全寬 issue/change block、pagination；只由狀態儲存格控制 disclosure，不設問題欄或 tooltip。
- Aggregated inventory：Section 1 單一表格顯示 blank／rejected／data outcome、已選列數與目前格式 output problem；Section 2 不複製檔案摘要。
- Standard output：Section 0 的 output choice、codec-specific problem、download、file-level status。
- Advanced output：獨立 reference picker、lookup plan/result、organized XLSX download。

Header readiness 使用共用 status indicator component。Component 擁有固定幾何、狀態色、文字 shimmer、`prefers-reduced-motion` 與 forced-colors fallback；readiness view 只提供 state 與文字。動畫不得被複製成另一套 section-specific CSS。

Live region 只宣告批次開始、完成、取消與目前選取檔案的重大結果；不得逐檔或逐列洗版。

## 12. Verification ownership

- Core tests：fixed profile、normalization、validation、transformation、mapping、serializer。
- Archive tests：safe path、depth 5、quota、symlink、collision、nested ZIP。
- Batch tests：decoder assignment、混合來源、filter、status aggregation、output selection、cancel stale work。
- View tests：rules disclosure、priority、pagination 100、selection、issue disclosure、blocked download。
- Advanced tests：reference workbook boundaries、exact/duplicate/missing match、stable output ordering；規格確認後才具體化。
- Build verifier：CSP、semantic shell、ARIA connections、manifest groups、base budget、obsolete settings residue。
- Browser smoke：雙格式選擇、active／other tabs、keyboard tree、issue disclosure、multi-file picker、download、offline reload。

每次 release candidate 都執行 `npm run verify`，並對未能自動驗證的 browser 行為明確記錄限制。
