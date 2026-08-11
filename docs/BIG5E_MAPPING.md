# 臺灣政府 BIG-5E 對照表

## 執行時契約

固定寬 TXT codec 使用數位發展部「CNS11643 中文標準交換碼全字庫」公開的對照資料，不使用瀏覽器 WHATWG Big5、HKSCS 或其他 vendor fallback。輸入欄位依官方 BIG-5E 對照逐段轉成 formal Unicode IR；無法對照的連續 byte segment 在 IR 以一個全形 `？` 代替，只保存該段、欄內位置及替代位置，前後有效文字不丟棄。預覽在該位置顯示 `■` 供核對，但 `■` 不進入 IR 或任何輸出。TXT 再輸出時會把 IR 中的 `？` 編為 BIG-5E；CSV／XLSX 輸出同一個 Unicode `？`。

應用程式執行時只讀取 repository 內產生完成的 `src/core/big5e-mapping.ts`，不向外連線。

## 固定來源

- 提供機關：數位發展部
- 資料集：CNS11643 中文標準交換碼全字庫
- 對照表版本：`20260505`
- 官方檔名：`MapingTables.zip`
- SHA-256：`f59dacc4dbdef334d7a887c3da671af02778e2c80adb2a7fd1053f64dbf9e659`
- 官方下載：https://www.cns11643.gov.tw/opendata/MapingTables.zip
- 資料集說明：https://data.gov.tw/dataset/5961/
- BIG-5E 說明：https://www.cns11643.gov.tw/pageView.jsp?ID=9&la=0
- 授權：政府資料開放授權條款第 1 版

產生器組合官方 BIG5-2003 主表、Big5 符號、七個倚天外字及 3,954 筆 BIG-5E 擴充，共 17,454 筆非 ASCII formal Unicode 對照。未由政府表指派 Unicode 的 user-defined slots 不視為可輸出的 mapping。產生時必須確認：

1. 壓縮檔 SHA-256 與固定版本一致。
2. 每一筆 CNS code 都有 formal Unicode 對照。
3. encoded code 與 Unicode code point 都沒有重複。
4. 各官方檔案筆數及總筆數維持固定。

以已下載並驗證的官方壓縮檔重建：

```bash
npm run generate:big5e-mapping -- /path/to/MapingTables.zip
```

## PUA 規則

目前 3,954 筆官方 BIG-5E 擴充都對應 formal Unicode，沒有 PUA code point。Section 1 不再把 BIG-5E output table 當成唯一 recovery resource；產生器另以完整 CNS／Unicode 與官方電信、稅務、工商、財稅及 25 份地政 legacy tables 建立 4,107 筆無歧義 compact recovery entries。官方 ZIP 的地政檔名未標示 UTF-8，產生器以固定來源的原始 Big5 路徑 bytes 辨識，避免漏讀這些表格。

- 唯一 formal Unicode 對照存在：保留 normalized original，將還原值寫入 final value 與 change log，並要求人工確認。
- 對照不存在或不同官方 legacy profiles 產生歧義：保留原值並產生簡短 error，不猜測字義。
- 同一欄混合 resolved 與 remained PUA 時，保留部分還原值及 change log，並以 remained error 為該 cell 的單一狀態。

`U+E088` 是 CP950 私用位置 `FAEA`，固定的官方表沒有為該位置提供 formal Unicode candidate。`廍` 本身是 CNS `3-6474`／Unicode `U+5ECD`，但官方各 legacy profile 使用的是其他 local code，不能據此建立全域 `U+E088 → 廍` 對照；地址脈絡即使能推知字義，也只能由使用者確認與修正。

這個處理只在來源驗證與最終驗證之間的 transformation 執行。Plane 15、Plane 16 與範圍外的 PUA 不猜測字義，也不使用 HKSCS fallback；未解決 PUA code point 留在 Unicode IR，CSV／XLSX 也保留原值。選擇 `TXT` 輸出時，內部以 17,454 筆 BIG-5E output mapping 檢查勾選列；未對照 PUA 與其他無 mapping Unicode 逐字以全形 `？` 代替，預覽在替代位置顯示 `■` 並列出 code point。這類替代不阻擋下載；只有替代後仍超過固定 byte 欄寬才是 fatal download problem。
