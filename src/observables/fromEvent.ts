import { Observable, fromEvent as _fromEvent } from 'rxjs';
import { Controller, ControllerEvent, EventType } from '../controllers';

/**
 * Strictly typed fromEvent for Controllers.
 *
 * Creates an Observable that emits events of the specified type
 * from a Controller.
 *
 * @example
 * ```typescript
 * const controller = DynamoDBController.from<MyType>(table);
 *
 * // Listen for modifications (INSERT/MODIFY)
 * fromEvent(controller, 'modified').subscribe(event => {
 *   console.log('Key:', event.key, 'Value:', event.value);
 * });
 *
 * // Listen for removals (manual deletes)
 * fromEvent(controller, 'removed').subscribe(event => {
 *   console.log('Removed:', event.key, event.value);
 * });
 *
 * // Listen for expirations (TTL deletes)
 * fromEvent(controller, 'expired').subscribe(event => {
 *   console.log('Expired:', event.key, event.value);
 * });
 *
 * // Write and delete items (returns Observable<void>)
 * controller.put({ id: '123', name: 'Alice' }).subscribe();
 * controller.remove({ id: '123' }).subscribe();
 * ```
 *
 * @param target The Controller to listen to
 * @param eventName The event type: 'modified', 'removed', or 'expired'
 * @returns Observable of events of type T
 */
export function fromEvent<T extends ControllerEvent>(
  target: Controller<T>,
  eventName: EventType
): Observable<T> {
  return _fromEvent<T>(target, eventName);
}
