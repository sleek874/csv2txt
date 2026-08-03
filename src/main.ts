import { createInputAdapter } from "./app/adapters/input-adapter";
import { createOutputAdapter } from "./app/adapters/output-adapter";
import { createCodecManager } from "./app/resources/codec-manager";
import { createInputController } from "./app/sections/input/input-controller";
import { createInputSectionView } from "./app/sections/input/input-section-view";
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
const codecs = createCodecManager();
const model = createWorkspaceModel();
const status = createAppStatus();

bindRulesView();

const inputController = createInputController({
  codecs,
  inputAdapter: createInputAdapter(codecs),
  model,
  offlineCache,
  status,
  unloadGuard: createUnloadGuard(),
  view: createInputSectionView(),
});
const outputController = createOutputController({
  codecs,
  model,
  outputAdapter: createOutputAdapter(codecs),
  status,
  view: createOutputView(),
});

inputController.bind();
outputController.bind();
void offlineCache.prepareOfflineUse();
