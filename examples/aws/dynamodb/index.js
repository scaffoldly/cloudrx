// CloudRx AWS DynamoDB Example
const { CloudSubject } = require('cloudrx');

console.log('CloudRx AWS DynamoDB Example');

// Create a CloudSubject backed by DynamoDB
console.log('Creating CloudSubject with DynamoDB persistence...');

const cloudSubject = new CloudSubject('my-stream', {
  type: 'aws-dynamodb',
  tableName: 'cloudrx-example'
});

console.log('CloudSubject created successfully!');

// Subscribe to the subject
cloudSubject.subscribe({
  next: (value) => console.log('Received:', value),
  error: (err) => console.error('Error:', err),
  complete: () => console.log('Complete')
});

// Emit some values
console.log('\nEmitting values...');
cloudSubject.next({ message: 'Hello CloudRx!', timestamp: new Date().toISOString() });
cloudSubject.next({ message: 'DynamoDB persistence rocks!', timestamp: new Date().toISOString() });

console.log('\nCloudRx DynamoDB example completed!');
console.log('Note: AWS credentials required for actual DynamoDB persistence');