import type { SourceFileType } from "../../core/file-formats";
import type { CodecManager } from "./codec-manager";

interface ResourceTasks {
  codecs: CodecManager;
  prepareFont: () => Promise<void>;
}

export interface ResourcePreparation {
  fullyPrepared: Promise<void>;
  readyForParsing: Promise<void>;
}

export function prepareSourceResources(
  sourceType: SourceFileType,
  tasks: ResourceTasks,
): ResourcePreparation {
  const readyForParsing = tasks.codecs.prepareSource(sourceType);
  return {
    readyForParsing,
    fullyPrepared: readyForParsing.then(tasks.prepareFont),
  };
}
