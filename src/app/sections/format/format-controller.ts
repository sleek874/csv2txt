import type { WorkspaceModel } from "../../state/workspace-model";
import type { FormatView } from "./format-view";

export function createFormatController(options: {
  model: WorkspaceModel;
  view: FormatView;
}) {
  return {
    bind() {
      options.view.bind({
        onInputChange: (format) => options.model.setInputFormat(format),
        onOutputChange: (format) => options.model.setOutputFormat(format),
      });
      options.model.subscribe(options.view.render);
      options.view.render(options.model.snapshot());
    },
  };
}
