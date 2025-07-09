import { Observable, from } from 'rxjs';
import { CloudOptions } from '../base';
import { Memory } from './provider';

/**
 * Builder class for Memory provider
 * Allows for fluent configuration of Memory provider options
 */
export class MemoryBuilder extends Observable<Memory> {
  private id: string;
  private options: CloudOptions = {};
  private delays: {
    init?: number;
    emission?: number;
    storage?: number;
  } = {};
  private initialized = false;
  
  constructor(id: string) {
    super(subscriber => {
      if (this.initialized) {
        return from(Memory.from(this.id, this.buildOptions())).subscribe(subscriber);
      }
      
      this.initialized = true;
      return from(Memory.from(this.id, this.buildOptions())).subscribe(subscriber);
    });
    this.id = id;
  }

  private checkInitialized(methodName: string): void {
    if (this.initialized) {
      throw new Error(`Cannot call ${methodName} after initialization`);
    }
  }

  private buildOptions() {
    return {
      ...this.options,
      delays: Object.keys(this.delays).length > 0 ? this.delays : undefined,
    };
  }

  /**
   * Set the initialization delay in milliseconds
   */
  withInitDelay(delay: number): this {
    this.checkInitialized('withInitDelay');
    this.delays.init = delay;
    return this;
  }

  /**
   * Set the emission delay in milliseconds
   */
  withEmissionDelay(delay: number): this {
    this.checkInitialized('withEmissionDelay');
    this.delays.emission = delay;
    return this;
  }

  /**
   * Set the storage delay in milliseconds
   */
  withStorageDelay(delay: number): this {
    this.checkInitialized('withStorageDelay');
    this.delays.storage = delay;
    return this;
  }

  /**
   * Set all delays at once
   */
  withDelays(init?: number, emission?: number, storage?: number): this {
    this.checkInitialized('withDelays');
    if (init !== undefined) this.delays.init = init;
    if (emission !== undefined) this.delays.emission = emission;
    if (storage !== undefined) this.delays.storage = storage;
    return this;
  }

  /**
   * Set the logger
   */
  withLogger(logger: CloudOptions['logger']): this {
    this.checkInitialized('withLogger');
    this.options.logger = logger;
    return this;
  }

  /**
   * Set the abort signal
   */
  withSignal(signal: AbortSignal): this {
    this.checkInitialized('withSignal');
    this.options.signal = signal;
    return this;
  }
}