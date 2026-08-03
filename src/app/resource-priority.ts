import type { SourceFileType } from "../core/source";

interface ResourceTasks {
  prepareExcel: () => Promise<void>;
  prepareFont: () => Promise<void>;
}

export interface ResourcePriority {
  fullyPrepared: Promise<void>;
  readyForParsing: Promise<void>;
}

export function prioritizeSourceResources(
  sourceType: SourceFileType,
  tasks: ResourceTasks,
): ResourcePriority {
  if (sourceType === "csv" || sourceType === "txt") {
    return {
      fullyPrepared: tasks.prepareFont(),
      readyForParsing: Promise.resolve(),
    };
  }

  const readyForParsing = tasks.prepareExcel();
  return {
    fullyPrepared: readyForParsing.then(tasks.prepareFont),
    readyForParsing,
  };
}
