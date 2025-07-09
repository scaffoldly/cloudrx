import type { Config } from '@jest/types';

export function testId(): string {
  return expect
    .getState()
    .currentTestName!.replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/--+/g, '-');
}

export default async function setup(
  globalConfig: Config.GlobalConfig
): Promise<void> {
  // Detect Jest flags from the global configuration
  const isVerbose = globalConfig.verbose || false;
  const isSilent = globalConfig.silent || false;

  // Set environment variable based on Jest flags for the logger to use
  if (isSilent) {
    process.env.JEST_LOG_LEVEL = 'silent';
  } else if (isVerbose) {
    process.env.JEST_LOG_LEVEL = 'debug';
  } else {
    process.env.JEST_LOG_LEVEL = 'info';
  }

  console.log(
    `\n[Global Setup] Jest flags detected - verbose: ${isVerbose}, silent: ${isSilent}, log level: ${process.env.JEST_LOG_LEVEL}\n`
  );
}
