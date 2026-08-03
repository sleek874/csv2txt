export function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`找不到必要的畫面元件：${selector}`);
  }
  return element;
}

export function requireDescendant<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`找不到必要的頁面元素：${selector}`);
  }
  return element;
}
