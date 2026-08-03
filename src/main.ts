import { createOutputAdapter } from "./app/output-adapter";
import { createArchiveParser } from "./app/archive-loader";
import { createSourceAdapter } from "./app/source-adapter";
import { createSpreadsheetParser } from "./app/spreadsheet-loader";
import { createWorkspaceController } from "./app/workspace-controller";
import { createWorkspaceView } from "./app/workspace-view";
import { requireElement } from "./browser/dom";
import { createOfflineCache, type OfflineCacheState } from "./browser/offline-cache";
import { createUnloadGuard } from "./browser/unload-guard";

const readinessStatus = requireElement<HTMLElement>("#readiness-status");
const readinessText = requireElement<HTMLElement>(
  "#readiness-status .readiness-status__text",
);

function renderOfflineStatus(state: OfflineCacheState): void {
  const presentations: Record<OfflineCacheState, { state: string; text: string }> = {
    development: { state: "development", text: "開發模式" },
    unsupported: { state: "limited", text: "需連線使用" },
    preparing: { state: "offline", text: "準備離線使用" },
    ready: { state: "ready", text: "已可離線使用" },
    error: { state: "limited", text: "需連線使用" },
  };
  const presentation = presentations[state];
  readinessStatus.dataset.state = presentation.state;
  readinessText.textContent = presentation.text;
}

const offlineCache = createOfflineCache({
  baseUrl: import.meta.env.BASE_URL,
  production: import.meta.env.PROD,
  onStateChange: renderOfflineStatus,
});
const spreadsheet = createSpreadsheetParser();
const view = createWorkspaceView();
const controller = createWorkspaceController({
  archive: createArchiveParser(),
  offlineCache,
  outputAdapter: createOutputAdapter(spreadsheet),
  sourceAdapter: createSourceAdapter(spreadsheet),
  spreadsheet,
  unloadGuard: createUnloadGuard(),
  view,
});

controller.bind();
void offlineCache.prepareOfflineUse();
