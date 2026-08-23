export interface CreatedOutput {
  blob: Blob;
  filename: string;
}

export function outputBlob(bytes: Uint8Array, mimeType: string): Blob {
  const part = bytes.buffer instanceof ArrayBuffer
    && bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer as ArrayBuffer;
  return new Blob([part], { type: mimeType });
}

export function taipeiMinuteStamp(date: Date): string {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Taipei",
    year: "numeric",
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}`;
}
