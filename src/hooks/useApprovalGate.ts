// ============================================================
// CellHub Pro — useApprovalGate (R-APPROVAL-PIN-V1)
// React hook that wires <ApprovalPinModal /> to the pure
// requestApproval orchestrator in services/security/approvalGuard.
//
// Owns the modal-prompter state + retry loop:
//   - On invalid_pin / self_approval_blocked → modal stays open,
//     inline error is set, and the guard is re-invoked using a
//     fresh prompter promise (matches AdminPinGate UX).
//   - On approved / cancelled / timeout / feature_disabled / not_required
//     → modal closes and the outer caller receives the final result.
//
// Intentionally NOT a Context — each consuming module instantiates
// its own gate so there's no coupling across modules.
// ============================================================

import { createElement, useCallback, useMemo, useRef, useState } from 'react';
import ApprovalPinModal from '@/components/shared/ApprovalPinModal';
import { requestApproval as runApprovalGuard } from '@/services/security/approvalGuard';
import type {
  ApprovalPrompter,
  ApprovalRequest,
  ApprovalResult,
  PrompterResponse,
} from '@/services/security/approvalGuard';
import { useTranslation } from '@/i18n';
import type { Employee } from '@/store/types';
import { registerApprovalResolver } from '@/services/companion/remoteApprovalGateway';
import { validateRemoteApprovalActor } from '@/services/companion/remoteApprovalTrust';

export interface UseApprovalGateArgs {
  employees: Employee[];
  settings: { adminPin?: string | null; approvalsEnabled?: boolean; companionRemoteApprovalEnabled?: boolean } | null | undefined;
  /** Optional name of the employee triggering the action — shown in the modal. */
  attemptedByName?: string;
}

export interface UseApprovalGateApi {
  /**
   * Run the approval flow for a restricted action. Resolves with the
   * final result. Caller should ONLY mutate when result.approved === true.
   */
  requestApproval: (req: ApprovalRequest) => Promise<ApprovalResult>;
  /** JSX node to render anywhere inside the consumer's tree. */
  modal: ReturnType<typeof createElement>;
}

export function useApprovalGate({
  employees,
  settings,
  attemptedByName,
}: UseApprovalGateArgs): UseApprovalGateApi {
  const { t, locale } = useTranslation();
  const [request, setRequest] = useState<ApprovalRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remoteApprovedMsg, setRemoteApprovedMsg] = useState<string | null>(null);
  const [remoteNote, setRemoteNote] = useState<string | null>(null);
  const resolverRef = useRef<((r: PrompterResponse) => void) | null>(null);
  const gatewayUnregisterRef = useRef<(() => void) | null>(null);

  // Refs for latest values so the prompter closure (stable, [] deps) reads
  // current state without stale captures.
  const employeesRef = useRef(employees);
  employeesRef.current = employees;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const tRef = useRef(t);
  tRef.current = t;

  // Per-attempt prompter — guard calls this once per submission. A fresh
  // promise is created per attempt; modal state stays mounted across retry
  // iterations so the user sees a continuous session.
  //
  // Phase 2B: also registers a one-shot gateway resolver keyed by approvalId.
  // If a validated Companion remote response arrives while the gate is open,
  // the resolver fires before any local PIN submission. validateRemoteApprovalActor
  // runs inside the resolver closure (reads live refs) before the gate resolves.
  const prompter: ApprovalPrompter = useCallback((req, approvalId) => {
    return new Promise<PrompterResponse>((resolve) => {
      // Wrap resolve so both local and remote paths clean up the gateway entry.
      const wrappedResolve = (r: PrompterResponse) => {
        gatewayUnregisterRef.current?.();
        gatewayUnregisterRef.current = null;
        resolverRef.current = null;
        resolve(r);
      };
      resolverRef.current = wrappedResolve;
      setRequest(req);

      // Register remote resolver. Validates actor, then either flashes
      // success (approve) or sets deny feedback and resolves (deny).
      // Invalid actor → silent no-op, local PIN modal stays open.
      gatewayUnregisterRef.current = registerApprovalResolver(approvalId, (response) => {
        const r = resolverRef.current;
        if (!r) return; // already resolved locally
        const trust = validateRemoteApprovalActor({
          isRemoteEnabled: () => !!settingsRef.current?.companionRemoteApprovalEnabled,
          managerId: response.managerId,
          employees: employeesRef.current,
          settings: settingsRef.current,
          gate: {
            actionType: req.actionType,
            requestedByEmployeeId: req.requestedByEmployeeId,
          },
        });
        if (!trust.valid) {
          console.warn('[approval-gate] remote actor rejected', trust.reason, response.managerId);
          return;
        }

        if (response.action === 'approve') {
          // Null resolver immediately — prevents cancel/timeout during the flash.
          resolverRef.current = null;
          gatewayUnregisterRef.current?.();
          gatewayUnregisterRef.current = null;
          // Show brief success flash, then resolve the Promise.
          setRemoteApprovedMsg(tRef.current('approval.remote.approvedMsg'));
          setTimeout(() => {
            r({ cancelled: false, remote: true, managerId: response.managerId });
          }, 600);
        } else {
          // Deny: set the manager note before resolving so the retry loop can
          // display it while the modal stays open for local PIN retry.
          setRemoteNote(response.managerNote ?? null);
          r({ cancelled: true, reason: 'remote_denied' });
        }
      });
    });
  }, []); // stable — all dynamic values accessed via refs

  const onSubmit = useCallback((pin: string) => {
    const r = resolverRef.current;
    resolverRef.current = null;
    if (r) r({ cancelled: false, pin });
  }, []);

  const onCancel = useCallback((reason: 'cancelled' | 'timeout') => {
    const r = resolverRef.current;
    resolverRef.current = null;
    if (r) r({ cancelled: true, reason });
  }, []);

  const requestApproval = useCallback(
    async (req: ApprovalRequest): Promise<ApprovalResult> => {
      setError(null);
      setRemoteApprovedMsg(null);
      setRemoteNote(null);
      // Retry loop: bad PIN / self-approval blocked / remote_denied → modal
      // stays open with inline error. Terminal reasons close the modal.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await runApprovalGuard(req, {
          employees,
          settings,
          prompter,
        });
        if (result.approved) {
          setRequest(null);
          setError(null);
          setRemoteApprovedMsg(null);
          setRemoteNote(null);
          return result;
        }
        if (result.reason === 'invalid_pin') {
          setError(t('approval.error.invalid'));
          continue;
        }
        if (result.reason === 'self_approval_blocked') {
          setError(t('approval.error.selfBlocked'));
          continue;
        }
        if (result.reason === 'remote_denied') {
          // Modal stays open — remoteNote already set by the gateway resolver.
          // Employee can retry with a local manager PIN or cancel.
          setError(t('approval.error.remoteDenied'));
          setRemoteApprovedMsg(null);
          continue;
        }
        // cancelled / timeout / feature_disabled / not_required → terminal
        setRequest(null);
        setError(null);
        setRemoteApprovedMsg(null);
        setRemoteNote(null);
        return result;
      }
    },
    [employees, settings, prompter, t],
  );

  const actionLabel = useMemo(() => {
    if (!request) return '';
    return t(`approval.action.${request.actionType}`);
  }, [request, t]);

  const modalLang = locale === 'es' ? 'es' : locale === 'pt' ? 'pt' : 'en';

  const modal = createElement(ApprovalPinModal, {
    open: !!request,
    lang: modalLang,
    actionLabel,
    attemptedByName,
    errorMessage: error,
    onSubmit,
    onCancel,
    remoteApprovedMsg,
    remoteNote,
  });

  return { requestApproval, modal };
}
