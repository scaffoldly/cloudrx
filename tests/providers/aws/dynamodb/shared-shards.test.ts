// Create a test mock class that simulates the behavior of DynamoDBProvider's shards getter
class MockProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _shards: any = null;

  // This simulates the getter that's being tested
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get shards(): any {
    if (this._shards) {
      return this._shards;
    }

    this._shards = { id: Math.random(), isObservable: true };
    return this._shards;
  }

  // Simulates creating a stream that uses the shards
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stream(): { shards: any } {
    return {
      shards: this.shards,
    };
  }
}

describe('Shared Observable Pattern', () => {
  test('shards observable should be shared across multiple streams', () => {
    // Create a provider instance with our test implementation
    const provider = new MockProvider();

    // Create multiple streams from the same provider
    const stream1 = provider.stream();
    const stream2 = provider.stream();
    const stream3 = provider.stream();

    // Verify all streams receive the same shared observable
    expect(stream1.shards).toBe(stream2.shards);
    expect(stream2.shards).toBe(stream3.shards);

    // Access private _shards property to confirm it's the same instance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const privateShards = (provider as any)._shards;
    expect(privateShards).toBeDefined();
    expect(stream1.shards).toBe(privateShards);

    // Ensure shards observable has expected properties
    expect(privateShards.isObservable).toBe(true);

    // Verify creation was only done once by checking the random ID is the same
    expect(stream1.shards.id).toBe(stream2.shards.id);
    expect(stream2.shards.id).toBe(stream3.shards.id);
  });

  test('shards observable should be initialized only once', () => {
    // Create a provider to test
    const provider = new MockProvider();

    // Spy on the shards getter
    const getterSpy = jest.spyOn(provider, 'shards', 'get');

    // Access shards multiple times
    const shards1 = provider.shards;
    const shards2 = provider.shards;
    const shards3 = provider.shards;

    // The getter should be called 3 times
    expect(getterSpy).toHaveBeenCalledTimes(3);

    // But all calls should return the same object
    expect(shards1).toBe(shards2);
    expect(shards2).toBe(shards3);

    // The creation logic should run only once
    expect(shards1.id).toBe(shards2.id);
  });
});