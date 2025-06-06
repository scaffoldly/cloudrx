import pino from 'pino';

// Centralized logger management to prevent Jest worker thread issues
class LoggerManager {
  private loggers: Set<pino.Logger> = new Set();

  createLogger(name: string, level: 'error' | 'info' | 'warn' | 'debug' = 'info'): pino.Logger {
    const logger = process.env.NODE_ENV === 'test' 
      ? pino({
          name,
          level: 'warn', // Only show warnings and errors in tests, hide debug/info
          transport: {
            target: 'pino-pretty',
            options: {
              destination: 1, // stdout
              colorize: false,
              levelFirst: true,
              translateTime: false,
              messageFormat: `[${name}] {msg}`,
              ignore: 'pid,hostname,time' // Clean up the output
            }
          }
        })
      : pino({
          name,
          level
        });

    this.loggers.add(logger);
    return logger;
  }

  async cleanup(): Promise<void> {
    const cleanupPromises = Array.from(this.loggers).map(logger => {
      return new Promise<void>((resolve) => {
        try {
          // Flush and close logger to prevent Jest hanging
          if ('flush' in logger) {
            (logger as unknown as { flush(callback?: () => void): void }).flush(() => {
              if ('close' in logger) {
                (logger as unknown as { close(): void }).close();
              }
              resolve();
            });
          } else {
            if ('close' in logger) {
              (logger as unknown as { close(): void }).close();
            }
            resolve();
          }
        } catch {
          resolve();
        }
      });
    });

    await Promise.all(cleanupPromises);
    this.loggers.clear();
  }
}

// Global logger manager instance
export const loggerManager = new LoggerManager();

// Convenience function to create loggers
export const createLogger = (name: string, level?: 'error' | 'info' | 'warn' | 'debug'): pino.Logger => 
  loggerManager.createLogger(name, level);

// Global cleanup function for tests
export const cleanupLoggers = (): Promise<void> => loggerManager.cleanup();