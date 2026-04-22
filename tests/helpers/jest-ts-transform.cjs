const ts = require("typescript");

module.exports = {
  process(sourceText, sourcePath) {
    const result = ts.transpileModule(sourceText, {
      fileName: sourcePath,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        allowJs: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
    });

    return {
      code: result.outputText,
    };
  },
};
