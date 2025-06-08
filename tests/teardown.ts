import { cleanupLoggers } from '../src/utils/logger';

export default async function (): Promise<void> {
  // Clean up all loggers to prevent Jest from hanging on worker threads
  await cleanupLoggers();
}
