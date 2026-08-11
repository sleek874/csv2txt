import type { AppStatus } from "../../shell/app-status";
import type { OutputAdapter } from "../../adapters/output-adapter";
import type { WorkspaceModel } from "../../state/workspace-model";
import { activeWorkspaceItems } from "../../state/workspace-selectors";
import { OUTPUT_PRESENTATIONS } from "./output-presentations";
import { createOutputPlan } from "./output-plan";
import type { OutputView } from "./output-view";

interface OutputControllerOptions {
  model: WorkspaceModel;
  outputAdapter: OutputAdapter;
  status: AppStatus;
  view: OutputView;
}

export function createOutputController(options: OutputControllerOptions) {
  let busy = false;
  let outputError: string | null = null;

  function requestKey(): string {
    const snapshot = options.model.snapshot();
    return JSON.stringify([
      snapshot.outputFormat,
      activeWorkspaceItems(snapshot).map((item) => [
        item.id,
        item.state,
        item.file?.rows.filter((row) => row.included).map((row) => row.sourceRow),
      ]),
    ]);
  }

  function render(): void {
    const snapshot = options.model.snapshot();
    options.view.render(createOutputPlan(snapshot), snapshot.outputFormat, busy);
    if (outputError && !busy) options.view.renderError(outputError);
  }

  async function download(): Promise<void> {
    const snapshot = options.model.snapshot();
    const plan = createOutputPlan(snapshot);
    if (!plan.canDownload) return;
    const requestedState = requestKey();
    busy = true;
    outputError = null;
    render();
    options.status.announce("正在建立下載。");
    try {
      const output = await options.outputAdapter.create(plan.files, snapshot.outputFormat);
      if (requestKey() !== requestedState) {
        outputError = "工作區已在建立下載期間變更，請重新下載。";
        options.status.announce("工作區已變更，下載已取消。");
        return;
      }
      options.view.save(output);
      options.status.announce(plan.files.length > 1
        ? `已建立 ${OUTPUT_PRESENTATIONS[snapshot.outputFormat].label} ZIP 下載。`
        : `已建立 ${OUTPUT_PRESENTATIONS[snapshot.outputFormat].label} 下載。`);
    } catch (error) {
      outputError = error instanceof Error ? error.message : "請重新整理後再試。";
      options.status.announce("無法建立下載。");
    } finally {
      busy = false;
      render();
    }
  }

  return {
    bind() {
      options.view.bind({
        onDownload: () => void download(),
      });
      options.model.subscribe(() => {
        outputError = null;
        render();
      });
      render();
    },
  };
}
