import { Observable, fromEvent as _fromEvent } from 'rxjs';
import {
  Controller,
  ControllerEvent,
  EventType,
} from '../controllers';

/**
 * Strictly typed fromEvent for Controllers.
 *
 * Creates an Observable that emits events of the specified type
 * from a Controller.
 *
 * @example
 * ```typescript
 * const controller = await DynamoDBController.from<MyType>('my-table');
 *
 * // Listen for modifications (INSERT/MODIFY)
 * fromEvent(controller, 'modified').subscribe(event => {
 *   console.log('Modified:', event.newValue);
 * });
 *
 * // Listen for removals (manual deletes)
 * fromEvent(controller, 'removed').subscribe(event => {
 *   console.log('Removed:', event.oldValue);
 * });
 *
 * // Listen for expirations (TTL deletes)
 * fromEvent(controller, 'expired').subscribe(event => {
 *   console.log('Expired:', event.oldValue);
 * });
 * ```
 *
 * @param target The Controller to listen to
 * @param eventName The event type: 'modified', 'removed', or 'expired'
 * @returns Observable of events of type T
 */
export function fromEvent<T extends ControllerEvent<unknown>>(
  target: Controller<T>,
  eventName: EventType
): Observable<T> {
  return _fromEvent<T>(target, eventName);
}
