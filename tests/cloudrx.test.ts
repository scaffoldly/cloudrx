import { CloudRx } from '../src/cloudrx';

describe('CloudRx', () => {
  let cloudRx: CloudRx;

  beforeEach(() => {
    cloudRx = new CloudRx();
  });

  it('should create an instance', () => {
    expect(cloudRx).toBeDefined();
  });

  it('should return hello message', () => {
    expect(cloudRx.hello()).toBe('Hello from CloudRx!');
  });
});