import type { AppStatus } from "../../shell/app-status";
import type { BatchClient } from "../../batch/batch-client";
import type { WorkspaceModel } from "../../state/workspace-model";
import { canonicalActiveWorkspaceItems } from "../../state/workspace-selectors";
import { OUTPUT_PRESENTATIONS } from "./output-presentations";
import { createOutputPlan, type OutputPreparationState } from "./output-plan";
import type { OutputView } from "./output-view";

interface OutputControllerOptions {
  batchClient: BatchClient;
  model: WorkspaceModel;
  status: AppStatus;
  view: OutputView;
}

export function createOutputController(options: OutputControllerOptions) {
  type Assessment =
    | { kind: "idle" }
    | { kind: "checking"; key: string }
    | { kind: "error"; key: string; message: string };
  type Generation =
    | { kind: "idle" }
    | { kind: "generating" }
    | { kind: "cancelling" }
    | { kind: "error"; message: string };

  let assessment: Assessment = { kind: "idle" };
  let generation: Generation = { kind: "idle" };
  let pendingTask = Promise.resolve();

  function isCancelling(): boolean {
    return generation.kind === "cancelling";
  }

  function requestKey(): string {
    const snapshot = options.model.snapshot();
    return JSON.stringify([
      snapshot.outputFormat,
      canonicalActiveWorkspaceItems(snapshot).map((item) => [
        item.id,
        item.file?.selectionRevision,
      ]),
    ]);
  }

  function assessmentKey(): string {
    const snapshot = options.model.snapshot();
    return JSON.stringify([
      snapshot.outputFormat,
      canonicalActiveWorkspaceItems(snapshot).flatMap((item) => item.file?.outputFormat === snapshot.outputFormat
        ? []
        : [[item.id, item.file?.selectionRevision ?? -1]]),
    ]);
  }

  function preparation(): { error: string | null; state: OutputPreparationState } {
    if (assessment.kind === "checking") return { error: null, state: "loading" };
    if (assessment.kind === "error") return { error: assessment.message, state: "error" };
    return { error: null, state: "ready" };
  }

  function render(): void {
    const snapshot = options.model.snapshot();
    const currentPreparation = preparation();
    const plan = createOutputPlan(snapshot, currentPreparation.state, currentPreparation.error);
    const busy = generation.kind === "generating" || generation.kind === "cancelling";
    options.view.render(plan, snapshot.outputFormat, busy, generation.kind === "cancelling");
    if (generation.kind === "error") options.view.renderError(generation.message, plan.canDownload);
  }

  async function checkOutput(): Promise<void> {
    const snapshot = options.model.snapshot();
    const stale = canonicalActiveWorkspaceItems(snapshot).flatMap((item) => (
      item.file
        && item.file.summary.includedRows > 0
        && item.file.outputFormat !== snapshot.outputFormat
        ? [item.file]
        : []
    ));
    if (stale.length === 0) {
      if (assessment.kind !== "idle") {
        assessment = { kind: "idle" };
        render();
      }
      return;
    }
    const key = assessmentKey();
    if (assessment.kind === "checking" && assessment.key === key) return;
    assessment = { kind: "checking", key };
    render();
    try {
      const refreshed = await options.batchClient.refreshOutput(
        stale.map((file) => file.id),
        snapshot.outputFormat,
      );
      if (assessmentKey() !== key) return;
      assessment = { kind: "idle" };
      options.model.updateFileRecords(refreshed);
    } catch {
      if (assessmentKey() !== key) return;
      assessment = {
        kind: "error",
        key,
        message: "無法完成輸出檢查。請重新選擇輸出格式後再試一次。",
      };
      render();
    }
  }

  async function download(): Promise<void> {
    const snapshot = options.model.snapshot();
    const plan = createOutputPlan(snapshot);
    if (!plan.canDownload) return;
    const requestedState = requestKey();
    generation = { kind: "generating" };
    render();
    options.status.announce("正在建立下載。");
    try {
      const output = await options.batchClient.createOutput(
        plan.files.map((file) => file.id),
        snapshot.outputFormat,
      );
      if (isCancelling()) {
        generation = { kind: "idle" };
        options.status.announce("已取消建立下載。");
        return;
      }
      if (requestKey() !== requestedState) {
        generation = {
          kind: "error",
          message: "工作區已在建立下載期間變更，請重新下載。",
        };
        options.status.announce("工作區已變更，下載已取消。");
        return;
      }
      options.view.save(output);
      options.status.announce(plan.files.length > 1
        ? `已建立 ${OUTPUT_PRESENTATIONS[snapshot.outputFormat].label} ZIP 下載。`
        : `已建立 ${OUTPUT_PRESENTATIONS[snapshot.outputFormat].label} 下載。`);
    } catch (error) {
      if (isCancelling()) {
        generation = { kind: "idle" };
        options.status.announce("已取消建立下載。");
        return;
      }
      generation = {
        kind: "error",
        message: requestKey() !== requestedState
          ? "工作區已在建立下載期間變更，請重新下載。"
          : error instanceof Error ? error.message : "請重新整理後再試。",
      };
      options.status.announce(requestKey() !== requestedState ? "工作區已變更，下載已取消。" : "無法建立下載。");
    } finally {
      if (generation.kind === "generating") {
        generation = { kind: "idle" };
      }
      render();
    }
  }

  function cancelDownload(): void {
    if (generation.kind !== "generating") return;
    generation = { kind: "cancelling" };
    render();
    options.status.announce("正在取消建立下載。");
    void options.batchClient.cancelOutput().catch(() => undefined);
  }

  return {
    bind() {
      options.view.bind({
        onCancel: cancelDownload,
        onDownload: () => { pendingTask = download(); void pendingTask; },
      });
      options.model.subscribe(() => {
        if (generation.kind === "error") generation = { kind: "idle" };
        render();
        pendingTask = checkOutput();
        void pendingTask;
      });
      render();
      pendingTask = checkOutput();
      void pendingTask;
    },
    whenIdle() { return pendingTask; },
  };
}
