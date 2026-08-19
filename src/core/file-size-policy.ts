export const FILE_SIZE_LIMIT_MIB = 100;
export const FILE_SIZE_LIMIT_BYTES = FILE_SIZE_LIMIT_MIB * 1024 * 1024;
export const FILE_SIZE_LIMIT_LABEL = `${FILE_SIZE_LIMIT_MIB} MB`;
export const FILE_SIZE_LIMIT_TECHNICAL_LABEL = `${FILE_SIZE_LIMIT_MIB} MiB`;

export function exceedsFileSizeLimit(byteLength: number): boolean {
  return byteLength > FILE_SIZE_LIMIT_BYTES;
}
