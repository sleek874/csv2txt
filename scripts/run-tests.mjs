import { spawnSync } from "node:child_process";

import { filesForScope, verifyTestScopes } from "../tests/test-scopes.mjs";

const scope = process.argv[2] ?? "all";
const testDirectory = new URL("../tests/", import.meta.url);
verifyTestScopes(testDirectory);
const files = filesForScope(scope).map((file) => new URL(`../tests/${file}`, import.meta.url).pathname);
const result = spawnSync(process.execPath, [
  "--import", new URL("../tests/register-typescript.mjs", import.meta.url).pathname,
  "--test",
  ...files,
], { stdio: "inherit" });

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
