import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CliLogger } from '../util/logger';

interface StreamArguments {
  provider: 'dynamodb' | 'memory';
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
              choices: ['dynamodb', 'memory'],
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

    // TODO: Implement actual streaming logic
    logger.warn('Streaming functionality not yet implemented');

    // Example of how stream data would go to stdout:
    // logger.outputStream(JSON.stringify({ event: 'sample' }) + '\n');
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
