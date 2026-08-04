import { isPrivateUseCodePoint } from "./encoding";

export type PrivateUseRecoveryLookup = (privateUse: number) => number | undefined;

export interface PrivateUseRecovery {
  value: string;
  recoveredCount: number;
  unresolvedCount: number;
}

export function recoverPrivateUse(
  value: string,
  lookup: PrivateUseRecoveryLookup,
): PrivateUseRecovery {
  let recovered = "";
  let recoveredCount = 0;
  let unresolvedCount = 0;

  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || !isPrivateUseCodePoint(codePoint)) {
      recovered += character;
      continue;
    }

    const formalCodePoint = lookup(codePoint);
    if (formalCodePoint === undefined) {
      recovered += character;
      unresolvedCount += 1;
      continue;
    }

    recovered += String.fromCodePoint(formalCodePoint);
    recoveredCount += 1;
  }

  return { value: recovered, recoveredCount, unresolvedCount };
}
