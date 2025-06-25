import pino from 'pino';
import { Logger } from '@util';

/**
 * Creates a test logger that respects Jest's built-in flags
 *
 * Usage:
 * - Jest --verbose shows debug logs
 * - Jest --silent shows no logs
 * - Normal mode shows info+ logs
 *
 * Convenience scripts:
 * - npm run test:silent (uses --silent flag)
 */
export function createTestLogger(name?: string): Logger {
  // Use Jest-detected level from global setup, default to 'info'
  const level = process.env.JEST_LOG_LEVEL || 'info';

  const pinoLogger = pino({
    name: name || 'test',
    level,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss.l',
        ignore: 'pid,hostname,name',
        messageFormat: name ? `[${name}] {msg}` : '{msg}',
      },
    },
  });

  // Adapt pino logger to our Logger interface
  return {
    debug: (...content: unknown[]): void => {
      const [message, ...args] = content;
      pinoLogger.debug(args.length > 0 ? { extra: args } : {}, String(message));
    },
    info: (...content: unknown[]): void => {
      const [message, ...args] = content;
      pinoLogger.info(args.length > 0 ? { extra: args } : {}, String(message));
    },
    warn: (...content: unknown[]): void => {
      const [message, ...args] = content;
      pinoLogger.warn(args.length > 0 ? { extra: args } : {}, String(message));
    },
    error: (...content: unknown[]): void => {
      const [message, ...args] = content;
      pinoLogger.error(args.length > 0 ? { extra: args } : {}, String(message));
    },
  };
}
