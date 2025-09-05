import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CliLogger } from '../util/logger';
import { DynamoDB } from '../providers';
import { fromEvent, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

interface StreamArguments {
  provider: 'dynamodb';
  resource: string;
  from?: string;
  format: 'json' | 'pretty';
}

export class Cli {
  static async run(): Promise<void> {
    await yargs(hideBin(process.argv))
      .scriptName('cloudrx')
      .usage('$0 <command> [options]')
      .command(
        'stream <provider> <resource> [from]',
        'Stream events from a cloud provider',
        (yargs) => {
          return yargs
            .positional('provider', {
              describe: 'Cloud provider (e.g., dynamodb)',
              type: 'string',
              choices: ['dynamodb'],
            })
            .positional('resource', {
              describe: 'Resource identifier (e.g., table name)',
              type: 'string',
            })
            .positional('from', {
              describe: 'Starting position (e.g., sequence number)',
              type: 'string',
            })
            .option('format', {
              describe: 'Output format',
              type: 'string',
              choices: ['json', 'pretty'],
              default: 'json',
            });
        },
        (argv) => Cli.handleStreamCommand(argv as StreamArguments)
      )
      .command('version', 'Show version information', {}, () =>
        Cli.handleVersionCommand()
      )
      .demandCommand(1, 'You need at least one command before moving on')
      .help('h')
      .alias('h', 'help')
      .example(
        '$0 stream dynamodb MyTable',
        'Stream events from DynamoDB table'
      )
      .example(
        '$0 stream dynamodb MyTable 12345',
        'Stream from sequence number'
      )
      .example('$0 version', 'Show version information')
      .parse();
  }

  private static async handleStreamCommand(
    argv: StreamArguments
  ): Promise<void> {
    const logger = new CliLogger();
    const { provider, resource, from, format } = argv;

    logger.info(`Streaming from ${provider}:${resource}`);
    if (from) logger.info(`Starting from: ${from}`);
    logger.info(`Format: ${format}`);

    const abortController = new AbortController();
    const signal = abortController.signal;

    // Handle process termination signals
    const cleanup = (): void => {
      logger.info('Shutting down stream...');
      abortController.abort();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    try {
      const options = {
        hashKey: 'id',
        rangeKey: 'timestamp',
        signal,
      };
      const provider$ = DynamoDB.from(resource, options);
      const cloudProvider = await firstValueFrom(provider$);

      logger.info('Starting stream...');

      // Create the stream with takeUntil for proper cleanup
      const stream$ = cloudProvider
        .stream(true)
        .pipe(takeUntil(fromEvent(signal, 'abort')));

      // Subscribe to the stream
      await new Promise<void>((resolve, reject) => {
        stream$.subscribe({
          next: (event: unknown) => {
            try {
              if (format === 'json') {
                logger.outputStream(JSON.stringify(event) + '\n');
              } else {
                // Pretty format
                const eventObj = event as {
                  timestamp?: number;
                  payload?: unknown;
                };
                const timestamp = eventObj.timestamp
                  ? new Date(eventObj.timestamp).toISOString()
                  : new Date().toISOString();
                logger.outputStream(
                  `[${timestamp}] ${JSON.stringify(eventObj.payload, null, 2)}\n`
                );
              }
            } catch (error) {
              logger.error('Error formatting output:', error);
            }
          },
          error: (error: unknown) => {
            if (error instanceof Error && error.name === 'AbortError') {
              logger.debug('Stream aborted');
              resolve();
            } else {
              logger.error('Stream error:', error);
              reject(error);
            }
          },
          complete: () => {
            logger.info('Stream completed');
            resolve();
          },
        });

        // Also resolve on abort signal
        signal.addEventListener('abort', () => resolve());
      });

      // Explicitly exit after stream completion
      process.exit(0);
    } catch (error) {
      logger.error('Failed to start stream:', error);
      process.exit(1);
    } finally {
      process.removeListener('SIGINT', cleanup);
      process.removeListener('SIGTERM', cleanup);
    }
  }

  private static async handleVersionCommand(): Promise<void> {
    const logger = new CliLogger();
    try {
      const packageJsonPath = join(__dirname, '../../package.json');
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      logger.info(`CloudRx CLI v${packageJson.version}`);
    } catch {
      logger.error('Failed to read version from package.json');
      logger.info('CloudRx CLI');
    }
  }
}
