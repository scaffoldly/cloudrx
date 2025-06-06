import ts from 'typescript';
import path from 'path';

export function runTypeCheck(): void {
  const configPath = path.resolve(__dirname, '../../tsconfig.json');

  console.log('🔍 Running TypeScript type checking...');

  // Read and parse the TypeScript config
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      `Failed to read tsconfig.json: ${ts.formatDiagnostic(configFile.error, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getNewLine: () => ts.sys.newLine,
      })}`
    );
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath)
  );

  if (parsedConfig.errors.length > 0) {
    const errorMessage = parsedConfig.errors
      .map((error) =>
        ts.formatDiagnostic(error, {
          getCanonicalFileName: (fileName) => fileName,
          getCurrentDirectory: ts.sys.getCurrentDirectory,
          getNewLine: () => ts.sys.newLine,
        })
      )
      .join('\n');
    throw new Error(`TypeScript config errors:\n${errorMessage}`);
  }

  // Create TypeScript program
  const program = ts.createProgram(
    parsedConfig.fileNames,
    parsedConfig.options
  );

  // Get all diagnostics (errors and warnings)
  const diagnostics = ts.getPreEmitDiagnostics(program);

  if (diagnostics.length > 0) {
    const errors = diagnostics.filter(
      (d) => d.category === ts.DiagnosticCategory.Error
    );
    const warnings = diagnostics.filter(
      (d) => d.category === ts.DiagnosticCategory.Warning
    );

    const formatDiagnostics = (diags: readonly ts.Diagnostic[]): string =>
      diags
        .map((diagnostic) =>
          ts.formatDiagnostic(diagnostic, {
            getCanonicalFileName: (fileName) => fileName,
            getCurrentDirectory: ts.sys.getCurrentDirectory,
            getNewLine: () => ts.sys.newLine,
          })
        )
        .join('\n');

    if (errors.length > 0) {
      console.error('❌ TypeScript compilation errors:');
      console.error(formatDiagnostics(errors));

      if (warnings.length > 0) {
        console.warn('⚠️  TypeScript compilation warnings:');
        console.warn(formatDiagnostics(warnings));
      }

      throw new Error(
        `TypeScript found ${errors.length} error(s) and ${warnings.length} warning(s). Tests cannot proceed with type errors.`
      );
    } else if (warnings.length > 0) {
      console.warn('⚠️  TypeScript compilation warnings:');
      console.warn(formatDiagnostics(warnings));
      console.log(
        `✅ TypeScript check passed - ${warnings.length} warning(s) but no errors`
      );
    }
  } else {
    console.log('✅ TypeScript check passed - no issues found');
  }
}
