// Example demonstrating alias usage for cloudrx

// Using @operators alias
import { persist } from '@operators';

// Using @providers alias  
import { DynamoDB, Memory } from '@providers';

// Using @util alias
import { Logger, NoOpLogger } from '@util';

// Example usage
import { of } from 'rxjs';

// DynamoDB example
const dynamoOptions = {
  client: /* your DynamoDB client */,
  hashKey: 'id',
  rangeKey: 'timestamp',
  signal: new AbortController().signal,
};

const dynamoProvider$ = DynamoDB.from('my-table', dynamoOptions);

// Memory provider example
const memoryOptions = {
  signal: new AbortController().signal,
};

const memoryProvider$ = Memory.from('my-memory-store', memoryOptions);

// Using persist operator with providers
const data$ = of({ id: '123', value: 'test data' });

// Persist to DynamoDB
data$.pipe(
  persist(dynamoProvider$)
).subscribe(result => {
  console.log('Persisted to DynamoDB:', result);
});

// Persist to Memory
data$.pipe(
  persist(memoryProvider$)
).subscribe(result => {
  console.log('Persisted to Memory:', result);
});