export function applyWhitespacePolicy(value: string, removeWhitespace: boolean): string {
  return removeWhitespace ? value.replace(/\s/gu, "") : value;
}
