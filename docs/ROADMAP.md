# 離線資料轉換 — 分階段更新計畫

## 原則

- 以目前兩種 parser／writer 已個別驗證的分支骨架為起點，不單獨合併該驗證分支的方向式 UI。
- 不維護舊設定、舊 DOM 或舊資料模型的相容層。
- 每一 phase 都只引入有實際使用者的模組與 dependency。
- 每一 phase 結束時，現存功能、測試、建置與離線資源契約必須可運作。
- 全域樣式、resource priority、offline cache 與 static verifier 是保留資產，不重寫成平行系統。

## 目前進度

- Phase 0 已完成。
- Phase 1 的固定 profile、共用 IR、正規化、欄位／日期／身分證／跨欄驗證及欄位10明確修改已建立。
- Phase 2 的四區靜態骨架、單一 picker、四種單檔 input adapter、共同 100-row 分頁預覽及兩種 output adapter 已建立。
- Phase 3 的多檔追加、扁平檔案清單、逐檔移除與 stale-work cancellation 已建立；目前虛擬路徑只是每個檔案的標籤，真正的資料夾／archive tree 與聚合節點仍待後續補齊。
- Phase 4 的共同 15 欄預覽、狀態排序與篩選、100-row 分頁、逐列輸出決策、兩次驗證及欄位10明確修改已建立。
- Phase 5 的 ZIP reader、safe path、quota、nested ZIP 與 lazy archive chunk 已提前隨第一個使用者完成；整批 ZIP writer 仍未實作。

## Phase 0 — Foundation

本階段：

- 以「離線資料轉換」更新產品文件與 package metadata。
- 固定 208-byte contract、批次 pipeline、內部表示與責任邊界。
- 將舊 SITE_REVIEW 保留為歷史基準，而不是目標規格。
- 檢查 dependency 狀態，只更新能通過完整驗證且有當前價值的項目。
- 不改動目前可運作 UI 或轉換行為。

完成條件：

- 文件沒有把未完成批次功能描述成已部署。
- DESIGN、ARCHITECTURE 與 README 彼此一致。
- `npm run verify` 通過。

## Phase 1 — Fixed profile and internal model

- 建立單一固定 profile，取代 editable column/settings domain。
- 建立共用 InternalFile、InternalRow、InternalCell 與 issue/change model。
- 新增日期、臺灣身分證、欄位、跨欄與 TEL 規則測試。
- 讓 CSV、XLS、XLSX 與 Big5 TXT adapter 都可產生相同內部表示。
- 保留現有 UI 作為暫時 consumer，直到 Phase 2 一次替換。

完成條件：

- 固定 15 欄與 208 bytes 只有一個 source of truth。
- 所有來源共用 validation model，model 不含 conversion direction。
- 不再從 runtime settings 決定欄寬或對齊。

## Phase 2 — Fresh static workflow

- 網站顯示名稱改為「離線資料轉換」。
- 移除設定檔 UI、column editor、global settings、local persistence 與舊 controller。
- Section 0 改為初始收合、點擊展開的固定欄位規則；regex 可見，hook 支援 hover、focus 與觸控說明。
- 以單一通用 file picker 取代方向 tabs；先接受 CSV、XLS、XLSX 與 Big5 TXT，Phase 5 由同一控制加入 ZIP。
- 移除手動 encoding selector；decoder metadata 只在自動判定有 issue 時顯示。
- Section 1 建立共用檔案選取、tree、IR 預覽、驗證與修改 shell；點選檔案顯示該檔摘要及 issue，輸入格式不改變版面。
- Section 2 提供整批 Big5 TXT 或 XLSX 的輸出選擇與下載狀態。
- Section 3 保留為進階輸出說明，不在 lookup contract 未定時建立無作用的 upload／mapping 控制。
- 更新 static verifier，確認沒有 settings residue。

完成條件：

- 沒有舊 settings schema、migration 或 selector compatibility code。
- 任一支援的單檔都進入相同工作流程，且可選擇任一輸出格式。
- 全域視覺、離線與可及性基礎未退化。

## Phase 3 — Batch inventory and file filtering

- File input 支援 multiple。
- 建立 safe virtual path 與 file/archive/folder node model。
- 自動辨識 CSV、XLS、XLSX 及 Big5 TXT adapter，所有支援 regular file 預設保留。
- Tree 支援逐檔移除與全部清除；後續資料夾節點再加入聚合狀態與整組操作。
- 建立 bounded processing queue、stale-work cancellation 與 file summary。
- 以 synthetic loose files 驗證追加與移除；ZIP dependency 由已提出需求的 Phase 5 reader 一併加入。

完成條件：

- 多檔不共享或覆蓋 parser state。
- Excluded file 不輸出並明確計數。
- Tree 可鍵盤操作且不只使用顏色。

## Phase 4 — Internal data table and transformations

- 選取檔案後顯示 15-column internal representation。
- 預設排序 error、warning、valid；同級依來源列號。
- 每頁最多 100 rows，支援狀態與修改篩選。
- Problem cell 以 hover、focus、touch 顯示 issue。
- 建立 source validation → modification → final validation。
- 將 `欄位10空值 → 0000000000` 移到來源與輸出格式無關的共用 transformation。

完成條件：

- Parser 與 writer 不再藏業務修正。
- 每個 modified cell 有 before/after/reason。
- Error／warning 列預設不輸出；預覽提供逐列核取方塊，明確勾選後可強制輸出。

## Phase 5 — Recursive ZIP and packaged output

- 加入經審查的 browser ZIP dependency 與 lazy archive chunk。
- 支援 nested ZIP 與 virtual directory，深度上限 5。
- 不跟隨 symlink；實作 safe path、quota、entry limit 與 collision error。
- 依整批輸出選擇，將每個保留檔案序列化為 Big5 TXT 或 XLSX。
- 輸出一個保留虛擬路徑的 ZIP；相同 stem 造成的輸出路徑碰撞必須報錯。
- 更新 offline cache group 與 build verifier。

完成條件：

- 惡意路徑、symlink、depth、quota 與 collision 有直接測試。
- ZIP dependency 不進入 base shell。
- 任一 kept error 阻止完整 ZIP。

## Phase 6 — Worker, performance and release hardening

- 將 archive、Excel、validation 與 serialization 移入單一有界 worker service。
- Main thread 只取得 tree summary 與目前 100-row page。
- 量測代表性 batch 的記憶體、取消時間、互動延遲與 ZIP 產生時間。
- 完成 keyboard、screen reader、mobile、reduced-motion、forced-colors、offline install/update smoke tests。
- 更新部署文件、agent discovery 與 release notes。

完成條件：

- 大型 batch 不長時間阻塞 UI。
- 取消不留下舊結果或未釋放 worker。
- 部署版離線與動態資源行為有 browser evidence。

## Deferred

### PR #21 後優先工作

1. 將目前扁平的工作區檔案清單改成真正的 folder／archive／file tree；建立父子節點、展開狀態、聚合嚴重程度、整組移除與鍵盤 tree navigation。在完成前，不把虛擬路徑字串當成已完成的階層模型。
2. 建立檔名解碼契約與 fixtures。普通 `File.name` 由瀏覽器提供 Unicode 字串；ZIP entry 另須保存原始名稱 bytes、UTF-8 flag、Unicode path metadata、採用的 decoder 與可信度。遇到來源不明或顯示替代字元時要提出 issue，不靜默猜測 Big5、重新命名或合併路徑。
3. 完成整批 output path 規劃、碰撞檢查與 ZIP writer，讓 Section 2 的格式選擇真正套用整批，而不是只下載目前選取檔案。
4. 把 CSV decoder 的低可信判定轉成可見的檔案 issue，補足副檔名／內容 signature 衝突測試。
5. 在 tree、整批 writer 與 page request contract 穩定後，再移入單一有界 worker，量測取消、記憶體與互動延遲。

### Future phase — Advanced organized XLSX

在實作前另行確認：

- Section 1 的哪個欄位或複合欄位作為 lookup key。
- 參照 workbook 的 worksheet 選擇、header／column mapping 及 key 正規化。
- Exact match 規則、重複 key、未命中、空 key 與型別差異的 severity。
- 對每個來源檔分別輸出或合併整批、輸出欄位／順序、排序、工作表及檔名。
- 進階 XLSX 已定位為標準輸出之外的額外 artifact；待確認併入同一 ZIP 或另行下載。

已確認的架構邊界：reference workbook 是 Section 3 專用輸入；lookup 只讀 final IR；不回寫 standard pipeline；預設輸出已解析值；reference／lookup error 不阻止 Section 2 標準輸出。若需保留 VLOOKUP 公式，必須另行明確定義。

### Other deferred work

- 使用者自訂 schema。
- 部分成功檔案下載。
- 任意 cell editor。
- Server processing、帳號、同步或 telemetry。
- 超過已驗證資源上限的超大型 ZIP。
