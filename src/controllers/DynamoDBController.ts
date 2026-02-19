import { Subscription, Observable } from 'rxjs';
import { Controller, EventListener, EventType } from './Controller';

export class DynamoDBController<T> extends Controller<T> {
  protected override on(
    type: EventType,
    listener: EventListener<T>
  ): Subscription {
    throw new Error('Method not implemented.');
  }
  override off(sub: Subscription): Observable<void> {
    throw new Error('Method not implemented.');
  }
}
