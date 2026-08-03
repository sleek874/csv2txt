export function downloadBytes(bytes: Uint8Array, mimeType: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
