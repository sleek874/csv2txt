const STORAGE_KEY = "csv2txt.advanced-columns.v1";

interface StoredPreferences {
  key: string;
  salt: string;
  selected: string[];
  version: 1;
}

export interface RestoredAdvancedColumns {
  keyColumnIndex: number | null;
  selectedColumnIndices: readonly number[];
}

export interface AdvancedColumnPreferences {
  restore(headers: readonly string[]): Promise<RestoredAdvancedColumns>;
  save(
    headers: readonly string[],
    keyColumnIndex: number,
    selectedColumnIndices: readonly number[],
  ): Promise<void>;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readPreferences(storage: Storage | null): StoredPreferences | null {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as Partial<StoredPreferences> | null;
    if (value?.version !== 1 || typeof value.salt !== "string" || typeof value.key !== "string"
      || !Array.isArray(value.selected) || value.selected.some((item) => typeof item !== "string")) {
      return null;
    }
    return value as StoredPreferences;
  } catch {
    return null;
  }
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function createAdvancedColumnPreferences(
  storage: Storage | null = browserStorage(),
  browserCrypto: Crypto = globalThis.crypto,
): AdvancedColumnPreferences {
  let stored = readPreferences(storage);
  let saveRevision = 0;

  async function hashHeader(salt: string, header: string): Promise<string> {
    const value = new TextEncoder().encode(`csv2txt.advanced-column.v1\0${salt}\0${header}`);
    return bytesToHex(new Uint8Array(await browserCrypto.subtle.digest("SHA-256", value)));
  }

  return {
    async restore(headers) {
      if (!stored) return { keyColumnIndex: null, selectedColumnIndices: [] };
      try {
        const hashes = await Promise.all(headers.map((header) => hashHeader(stored!.salt, header)));
        const selected = new Set(stored.selected);
        const keyColumnIndex = hashes.indexOf(stored.key);
        return {
          keyColumnIndex: keyColumnIndex >= 0 ? keyColumnIndex : null,
          selectedColumnIndices: hashes.flatMap((hash, index) => selected.has(hash) ? [index] : []),
        };
      } catch {
        return { keyColumnIndex: null, selectedColumnIndices: [] };
      }
    },
    async save(headers, keyColumnIndex, selectedColumnIndices) {
      const revision = ++saveRevision;
      try {
        const salt = stored?.salt ?? bytesToHex(browserCrypto.getRandomValues(new Uint8Array(16)));
        const hashes = await Promise.all(headers.map((header) => hashHeader(salt, header)));
        if (revision !== saveRevision || !hashes[keyColumnIndex]) return;
        const next: StoredPreferences = {
          key: hashes[keyColumnIndex],
          salt,
          selected: selectedColumnIndices.flatMap((index) => hashes[index] ? [hashes[index]] : []),
          version: 1,
        };
        stored = next;
        try {
          storage?.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Keep the preference for this page session when persistent storage is unavailable.
        }
      } catch {
        // Column selection remains usable when hashing is unavailable.
      }
    },
  };
}
