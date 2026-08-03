export function concatenateBytes(
  chunks: readonly Uint8Array[],
  expectedLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
): Uint8Array {
  const output = new Uint8Array(expectedLength);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset + chunk.byteLength > expectedLength) {
      throw new Error("位元組內容超過預期大小。");
    }
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (offset !== expectedLength) {
    throw new Error("位元組內容與預期大小不一致。");
  }
  return output;
}
