// R-OPERATOR-EVENTS-V1 — public surface for the operator event bus.
export type { OperatorEventType, OperatorEvent } from './types';
export {
  publishOperatorEvent,
  subscribeOperatorEvents,
  getOperatorEvents,
  getOperatorEventsByType,
  clearOperatorEvents,
} from './operatorEventBus';
