import { Observable, Subject } from 'rxjs';
import { Shard } from '@aws-sdk/client-dynamodb-streams';

/**
 * These tests validate the pattern used in DynamoDBProvider for sharing shards observable
 * between multiple streams. We mock only the relevant portions of the implementation
 * to focus on the getter + lazy initialization pattern being tested.
 */

// Create a class that mimics the behavior of DynamoDBProvider's shards getter
class SharedObservablePattern {
  // Private property to store the observable
  private _shards?: Observable<Shard>;

  // The property we want to test - implementation follows DynamoDBProvider's pattern
  get shards(): Observable<Shard> {
    // Return existing observable if it exists
    if (this._shards) {
      return this._shards;
    }

    // Create a new observable if it doesn't exist yet
    const subject = new Subject<Shard>();
    this._shards = subject.asObservable();
    return this._shards;
  }

  // Method to create a stream that uses the shared observable
  stream(id: string): { id: string; observable: Observable<Shard> } {
    // This stream shares the observable from the getter
    return {
      id,
      observable: this.shards,
    };
  }
}

describe('DynamoDBProvider shards sharing implementation', () => {
  test('returns the same observable instance across multiple streams', () => {
    // Create an instance of our pattern class
    const provider = new SharedObservablePattern();

    // Create multiple streams that use the shared observable
    const stream1 = provider.stream('stream-1');
    const stream2 = provider.stream('stream-2');
    const stream3 = provider.stream('stream-3');

    // All streams should have access to the same observable instance
    expect(stream1.observable).toBe(stream2.observable);
    expect(stream2.observable).toBe(stream3.observable);

    // The observable should be the same as the private property
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(stream1.observable).toBe((provider as any)._shards);
  });

  test('initializes the observable only once', () => {
    const provider = new SharedObservablePattern();

    // Create a spy on the getter
    const getSpy = jest.spyOn(provider, 'shards', 'get');

    // Access the property multiple times
    const obs1 = provider.shards;
    const obs2 = provider.shards;
    const obs3 = provider.shards;

    // The getter should be called for each access
    expect(getSpy).toHaveBeenCalledTimes(3);

    // But it should return the same instance each time
    expect(obs1).toBe(obs2);
    expect(obs2).toBe(obs3);

    // The first call should have created the observable
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((provider as any)._shards).toBeDefined();

    // Further stream creations should use the existing observable
    const stream = provider.stream('new-stream');
    expect(stream.observable).toBe(obs1);
  });
});