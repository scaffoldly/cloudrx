export * from './operators';
export * from './providers';

export interface Logger {
  trace?: (...content: unknown[]) => void;
  debug: (...content: unknown[]) => void;
  info: (...content: unknown[]) => void;
  warn: (...content: unknown[]) => void;
  error: (...content: unknown[]) => void;
}

export class NoOpLogger implements Logger {
  trace = (): void => {};
  debug = (): void => {};
  info = (): void => {};
  warn = (): void => {};
  error = (): void => {};
}
