/* eslint-disable @typescript-eslint/no-explicit-any */
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
