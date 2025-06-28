export interface Logger {
  trace?: (...content: unknown[]) => void;
  debug: (...content: unknown[]) => void;
  info: (...content: unknown[]) => void;
  warn: (...content: unknown[]) => void;
  error: (...content: unknown[]) => void;
}

export class ErrorLogger implements Logger {
  constructor(private destination: Logger = console) {}

  trace = (): void => {};
  debug = (): void => {};
  info = (): void => {};
  warn = (...content: unknown[]): void => {
    this.destination.warn(...content);
  };
  error = (...content: unknown[]): void => {
    this.destination.error(...content);
  };
}
