import {
  DynamoDBClientConfig,
  TableDescription,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBController } from '../../src/controllers/aws/dynamodb';
import { DynamoDBLocalContainer } from '../providers/aws/dynamodb/local';

export function uniqueTableName(): string {
  return `test-table-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createTable(
  docClient: DynamoDBDocumentClient,
  tableName: string
): Promise<TableDescription> {
  const { CreateTableCommand, DescribeTableCommand } = await import(
    '@aws-sdk/client-dynamodb'
  );

  await docClient.send(
    new CreateTableCommand({
      TableName: tableName,
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
      BillingMode: 'PAY_PER_REQUEST',
      StreamSpecification: {
        StreamEnabled: true,
        StreamViewType: 'NEW_AND_OLD_IMAGES',
      },
    })
  );

  let tableDescription: TableDescription | undefined;
  for (let i = 0; i < 30; i++) {
    const response = await docClient.send(
      new DescribeTableCommand({ TableName: tableName })
    );
    if (response.Table?.TableStatus === 'ACTIVE') {
      tableDescription = response.Table;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!tableDescription) {
    throw new Error('Table did not become active');
  }

  return tableDescription;
}

export function createClientConfig(
  container: DynamoDBLocalContainer
): DynamoDBClientConfig {
  return {
    endpoint: container.getEndpoint(),
    region: 'local',
    credentials: { accessKeyId: 'fake', secretAccessKey: 'fake' },
  };
}

export function clearControllerCache(): void {
  (
    DynamoDBController as unknown as { instances: Map<string, unknown> }
  ).instances.clear();
}
