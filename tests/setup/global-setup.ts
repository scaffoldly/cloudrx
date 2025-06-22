import type { Config } from '@jest/types';

/**
 * Jest Global Setup Module
 * This runs once before all tests and has access to Jest configuration
 * We use it to detect --verbose and --silent flags and set environment variables
 */
export default async function globalSetup(
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

  // Optional: log what we detected (only visible when not silent)
  if (!isSilent) {
    console.log(
      `[Global Setup] Jest flags detected - verbose: ${isVerbose}, silent: ${isSilent}, log level: ${process.env.JEST_LOG_LEVEL}`
    );
  }
}
