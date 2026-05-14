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
import { emitApprovalRequested, emitApprovalAccepted, emitApprovalDenied } from '@/services/intelligence/liveContext/liveContextEvents';
import type {
  ApprovalPrompter,
  ApprovalRequest,
  ApprovalResult,
  PrompterResponse,
} from '@/services/security/approvalGuard';
import { useTranslation } from '@/i18n';
import type { Employee } from '@/store/types';

export interface UseApprovalGateArgs {
  employees: Employee[];
  settings: { adminPin?: string | null; approvalsEnabled?: boolean } | null | undefined;
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
  const resolverRef = useRef<((r: PrompterResponse) => void) | null>(null);

  // Per-attempt prompter — guard calls this once per submission. We hand
  // back a fresh promise each call; modal state stays mounted across
  // iterations of the retry loop so the user sees a continuous session.
  const prompter: ApprovalPrompter = useCallback((req) => {
    return new Promise<PrompterResponse>((resolve) => {
      resolverRef.current = resolve;
      setRequest(req);
    });
  }, []);

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
      emitApprovalRequested(req.actionType);
      // Retry loop: bad PIN / self-approval blocked → stay open with inline
      // error. Final reasons (cancelled / timeout / approved / not-required)
      // exit the loop and close the modal.
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
          emitApprovalAccepted(req.actionType);
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
        // cancelled / timeout / feature_disabled / not_required → terminal
        setRequest(null);
        setError(null);
        if (result.reason === 'cancelled' || result.reason === 'timeout') {
          emitApprovalDenied(req.actionType);
        }
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
  });

  return { requestApproval, modal };
}
