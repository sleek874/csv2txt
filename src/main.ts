import { createBatchClient } from "./app/batch/batch-client";
import { createAdvancedController } from "./app/sections/advanced/advanced-controller";
import { createAdvancedView } from "./app/sections/advanced/advanced-view";
import { createInputController } from "./app/sections/input/input-controller";
import { createInputSectionView } from "./app/sections/input/input-section-view";
import { createFormatController } from "./app/sections/format/format-controller";
import { createFormatView } from "./app/sections/format/format-view";
import { createOutputController } from "./app/sections/output/output-controller";
import { createOutputView } from "./app/sections/output/output-view";
import { bindRulesView } from "./app/sections/rules/rules-view";
import { createAppStatus } from "./app/shell/app-status";
import { createReadinessView } from "./app/shell/readiness-view";
import { createWorkspaceModel } from "./app/state/workspace-model";
import { createOfflineCache } from "./browser/offline-cache";
import { createUnloadGuard } from "./browser/unload-guard";

const readinessView = createReadinessView();
const offlineCache = createOfflineCache({
  baseUrl: import.meta.env.BASE_URL,
  production: import.meta.env.PROD,
  onStateChange: readinessView.render,
});
const batchClient = createBatchClient();
const model = createWorkspaceModel();
const status = createAppStatus();
const unloadGuard = createUnloadGuard();

bindRulesView();

const inputController = createInputController({
  batchClient,
  model,
  offlineCache,
  status,
  unloadGuard,
  view: createInputSectionView(),
});
const formatController = createFormatController({ batchClient, model, view: createFormatView() });
const outputController = createOutputController({
  batchClient,
  model,
  status,
  view: createOutputView(),
});
const advancedController = createAdvancedController({
  batchClient,
  model,
  status,
  unloadGuard,
  view: createAdvancedView(),
});

inputController.bind();
formatController.bind();
outputController.bind();
advancedController.bind();
void offlineCache.prepareOfflineUse();
