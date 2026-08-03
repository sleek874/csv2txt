# 離線資料轉換 — 架構與資源責任

## 1. 架構目標

下一個主要版本保留已驗證的靜態頁面、離線、視覺與檔案轉換骨架，但不延伸舊 settings-first controller。新架構以共用內部表示為唯一工作區，讓所有輸入格式、批次 ZIP、驗證、修改、預覽與兩種輸出共用同一條可測試資料管線。

原則：

- Core 不接觸 DOM、File picker、下載或 live region。
- Input adapter 只解析，不執行隱藏的業務修正。
- Validation 不直接產生 bytes 或 workbook。
- Modification 必須留下 before/after 與 reason。
- Serializer 只接受通過最終驗證的內部資料。
- Main entry 只負責組裝，不累積業務條件。
- 模組以清楚責任為主，不建立大量只有一個 trivial function 的檔案。

## 2. 目標資料流

```text
File / ZIP
  -> inventory and safe virtual paths
  -> automatic decoder selection
  -> kept-file filter
  -> input adapter
  -> normalized internal representation
  -> source validation
  -> explicit filters and modifications
  -> final validation
  -> batch output-format selection
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
type OutputFormat = "big5-txt" | "xlsx";
type Severity = "error" | "warning";

interface InternalFile {
  id: string;
  virtualPath: string;
  rows: InternalRow[];
  summary: FileSummary;
}

interface BatchState {
  inventory: BatchNode[];
  files: InternalFile[];
  outputFormat?: OutputFormat;
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
- 來源種類與 decoder metadata 屬於 inventory／orchestration，不進入 logical IR，也不建立 UI 方向模式。
- `outputFormat` 是整批在下載階段的獨立選擇，不存入每列或每個 cell。
- `included` 是每列的輸出決策：沒有 issue 時預設為 `true`，有 error 或 warning 時預設為 `false`，之後只由預覽中的使用者操作改變。
- 原值只有在不同、發生 issue 或需說明修改時保存。
- Final value 採 copy-on-write，沒有修改就不重複字串。
- UI 只取得摘要及目前 100-row page。
- 原始 bytes 在不再需要後可釋放。
- 內部表示不持久化。

## 4. 責任區分

| 區域 | 責任 | 不應負責 |
|---|---|---|
| Fixed profile | 欄寬、regex、hook metadata、固定 modifier 宣告 | DOM、檔案讀取、ZIP |
| Input adapters | CSV、Excel、Big5 TXT 解析為 logical rows | 補 TEL、下載、UI issue render |
| Normalization | 移除空白、空白列、ID 大寫、來源列號 | 最終 byte padding |
| Validation | 欄位、日期、checksum、跨欄、severity | 直接修改值 |
| Transformations | 明確列篩選與值修改、change log | 隱藏修正 validator error |
| Output adapters | Big5 TXT bytes、XLSX workbook | Parser fallback、UI state |
| Advanced lookup | 參照 workbook、有序 join plan、match issue、整理後 workbook model | 修改 primary IR、隱藏 fallback、阻擋 standard output |
| Archive | ZIP inventory、quota、安全路徑、ZIP output | 欄位規則 |
| Batch orchestration | Queue、取消、狀態聚合、資源需求、整批輸出選擇 | Validator 細節、DOM markup |
| Views | Tree、summary、100-row page、issue popover | 解析、checksum、ZIP 解壓 |
| Browser integration | File picker、download、unload guard、theme | Domain 規則 |

## 5. 目前模組輪廓

目前只保留已有實際使用者的模組；進階輸出、資料夾節點與 worker 在對應契約確認前不建立空殼。

```text
src/
  core/
    fixed-profile.ts
    internal-model.ts
    conversion-pipeline.ts
    normalization.ts
    validation.ts
    transformations.ts
    encoding.ts
    csv.ts
    spreadsheet.ts
    fixed-width.ts
    fixed-width-inverse.ts
    archive.ts
    source.ts
  app/
    workspace-controller.ts
    workspace-view.ts
    source-adapter.ts
    output-adapter.ts
    resource-priority.ts
    spreadsheet-loader.ts
    archive-loader.ts
  browser/
    dom.ts
    offline-cache.ts
    theme.ts
    unload-guard.ts
```

`src/main.ts` 只建立共享的 spreadsheet、archive、offline cache、controller 與 view，並連接頂層生命週期。`workspace-controller.ts` 負責批次狀態與流程；`workspace-view.ts` 集中管理目前單一頁面的 DOM 呈現。等真正的資料夾節點或 worker page protocol 成為使用者後，再沿 `file-tree-view` 與 `data-page-view` 邊界拆分，避免先建立只有轉呼叫的薄模組。

## 6. Batch state

Batch node 至少包含：

- 穩定 ID。
- Safe virtual path。
- Node kind：folder、archive、regular file、symlink、unsupported。
- Include/exclude state。
- Waiting、processing、valid、warning、error 狀態。
- Decoder metadata。
- Row/error/warning/modified/excluded counts。
- Output path 或 collision issue。

資料夾與 ZIP 僅聚合子節點狀態。UI 不自行重新推導 conversion correctness。

一般 UI 不固定顯示 `sourceKind` 或 decoder metadata；檔名本身已足以供使用者辨識，只有自動判定發生 warning 或 error 時才在 issue 中揭露必要診斷。

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

保留 `src/app/spreadsheet-loader.ts` 的單一 memoized loader 與 Excel manual chunk：

- Inventory 或 parser 遇到 XLS/XLSX input 時載入 Excel。
- CSV 或 Big5 TXT input 本身不載入 Excel。
- 使用者選擇 XLSX output、實際需要建立 workbook 時載入 Excel。
- Section 3 讀取 reference workbook 與產生 organized XLSX 時重用同一個 loader，不建立第二套 Excel dependency。
- Batch 中多個檔案共用同一個 module promise。

### ZIP

ZIP library 採獨立 lazy chunk，由單一 `archive-loader` 管理：

- Inventory 發現 ZIP 時載入 reader。
- 只有準備下載時載入 writer 路徑。
- 不在 UI component 直接 import ZIP dependency。
- 解壓時使用 stream/filter/quota，不使用無界 `unzipSync` 處理整批內容。

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

未被當前 phase 使用的 dependency 不先加入。選定 ZIP library 後，應在 archive phase 與第一個使用者一起提交。

## 10. Fresh-start policy

下一版不提供：

- Settings v3 parser 或 migration。
- 舊 settings JSON upload/download。
- 舊 localStorage 值轉換。
- 舊 DOM selector compatibility shim。
- 方向 tabs、方向狀態或正向／反向舊用語 alias。

舊 controller、markup、types、tests 與 static verifier assertions 已由新契約取代；不要恢復第二條 code path。

目前 `agent/big5-txt-to-xlsx` 的價值是驗證既有核心能解析 Big5 TXT 並產生 XLSX；下一版會抽取可重用的 parser、writer、resource loader 與測試證據，而不是保留其頁面結構或方向模型。

## 11. Styles and accessibility

保留現有全域 palette、spacing、border、shadow、responsive-grid、light/dark、reduced-motion 與穩定 layout 基礎。新增 UI 優先組合既有 token；只有跨兩個以上新 component 的共用模式才建立新 primitive。

責任建議：

- Foundation：tokens、reset、通用 layout、controls。
- Rules disclosure：初始收合的固定 profile、regex 與可鍵盤開啟的 hook 說明。
- Batch tree：tree/list、node state、selection。
- Data page：15-column table、cell severity、pagination。
- Standard output：summary、整批 output selector、download、file-level status。
- Advanced output：獨立 reference picker、lookup plan/result、organized XLSX download。

Live region 只宣告批次開始、完成、取消與目前選取檔案的重大結果；不得逐檔或逐列洗版。

## 12. Verification ownership

- Core tests：schema、normalization、validation、transformation、serializer。
- Archive tests：safe path、depth 5、quota、symlink、collision、nested ZIP。
- Batch tests：decoder assignment、混合來源、filter、status aggregation、output selection、cancel stale work。
- View tests：rules disclosure、priority、pagination 100、selection、issue disclosure、blocked download。
- Advanced tests：reference workbook boundaries、exact/duplicate/missing match、stable output ordering；規格確認後才具體化。
- Build verifier：CSP、semantic shell、ARIA connections、manifest groups、base budget、obsolete settings residue。
- Browser smoke：keyboard tree, focus/click popover, multi-file picker, download, offline reload。

每個 phase 都執行 `npm run verify`，並對未能自動驗證的 browser 行為明確記錄限制。
