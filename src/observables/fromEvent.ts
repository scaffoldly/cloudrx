import { fromEvent as _fromEvent } from 'rxjs';
import { Controller, EventType } from '../controllers/Controller';

type Target<T> = Controller<T> | ArrayLike<Controller<T>>;
type EventName = EventType;

// TODO: re-export fromEvent with stricter typings
