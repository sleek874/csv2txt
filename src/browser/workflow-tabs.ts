import { requireElement } from "./dom";

type WorkflowTab = HTMLButtonElement;

function controlledPanel(tab: WorkflowTab): HTMLElement {
  const panelId = tab.getAttribute("aria-controls");
  if (!panelId) {
    throw new Error("轉換方向頁籤缺少對應內容。");
  }
  return requireElement<HTMLElement>(`#${panelId}`);
}

export function installWorkflowTabs(): void {
  const tabList = requireElement<HTMLElement>("#workflow-tabs");
  const tabs = Array.from(
    tabList.querySelectorAll<WorkflowTab>("[role='tab']"),
  );

  function activate(tab: WorkflowTab, focus = false): void {
    tabs.forEach((currentTab) => {
      const selected = currentTab === tab;
      currentTab.setAttribute("aria-selected", String(selected));
      currentTab.tabIndex = selected ? 0 : -1;
      controlledPanel(currentTab).hidden = !selected;
    });
    if (focus) {
      tab.focus();
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      let nextIndex: number | null = null;
      if (event.key === "ArrowRight") {
        nextIndex = (index + 1) % tabs.length;
      } else if (event.key === "ArrowLeft") {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = tabs.length - 1;
      }

      const nextTab = nextIndex === null ? null : tabs[nextIndex];
      if (nextTab) {
        event.preventDefault();
        activate(nextTab, true);
      }
    });
  });

  const selectedTab = tabs.find(
    (tab) => tab.getAttribute("aria-selected") === "true",
  ) ?? tabs[0];
  if (selectedTab) {
    activate(selectedTab);
  }
}
