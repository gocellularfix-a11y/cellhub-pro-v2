/**
 * R-BRIDGE-V5 — Desktop POS SDK entrypoint.
 *
 * External CellHub POS code should import everything from this module
 * rather than reaching into the individual files.
 */

export {
  createPosBridgeClient,
} from './posBridgeClient';
export type {
  PosBridgeClient,
  PosBridgeClientConfig,
  PosBridgeStatus,
} from './posBridgeClient';

export { initApprovalEmitter, approvalEmitter } from './approvalEmitter';
export { initMessageEmitter, messageEmitter } from './messageEmitter';
export { initIntelligenceEmitter, intelligenceEmitter } from './intelligenceEmitter';
