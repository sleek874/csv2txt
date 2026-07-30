import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const isExtensionlessRelativeImport =
        (specifier.startsWith("./") || specifier.startsWith("../"))
        && !/\.[a-z0-9]+$/iu.test(specifier);

      if (
        !(error instanceof Error)
        || !("code" in error)
        || error.code !== "ERR_MODULE_NOT_FOUND"
        || !isExtensionlessRelativeImport
      ) {
        throw error;
      }

      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
