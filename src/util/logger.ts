/* eslint-disable @typescript-eslint/no-explicit-any */
import { format } from 'util';

export interface Logger {
  log?(message?: any, ...optionalParams: any[]): void;
  debug?(message?: any, ...optionalParams: any[]): void;
  info?(message?: any, ...optionalParams: any[]): void;
  warn?(message?: any, ...optionalParams: any[]): void;
  error?(message?: any, ...optionalParams: any[]): void;
  trace?(message?: any, ...optionalParams: any[]): void;
}

export class InfoLogger implements Logger {
  info(message?: any, ...optionalParams: any[]): void {
    // eslint-disable-next-line no-console
    console.info(message, ...optionalParams);
  }

  error(message?: any, ...optionalParams: any[]): void {
    // eslint-disable-next-line no-console
    console.error(message, ...optionalParams);
  }
}

export class CliLogger implements Logger {
  info(message?: any, ...optionalParams: any[]): void {
    const formatted = format(message, ...optionalParams);
    process.stderr.write(`[INFO] ${formatted}\n`);
  }

  error(message?: any, ...optionalParams: any[]): void {
    const formatted = format(message, ...optionalParams);
    process.stderr.write(`[ERROR] ${formatted}\n`);
  }

  warn(message?: any, ...optionalParams: any[]): void {
    const formatted = format(message, ...optionalParams);
    process.stderr.write(`[WARN] ${formatted}\n`);
  }

  debug(message?: any, ...optionalParams: any[]): void {
    if (process.env.DEBUG === '1') {
      const formatted = format(message, ...optionalParams);
      process.stderr.write(`[DEBUG] ${formatted}\n`);
    }
  }

  outputStream(data: string): void {
    process.stdout.write(data);
  }
}
