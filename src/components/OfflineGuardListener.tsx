// ============================================================
// R-OFFLINE-MODE-GUARD-V1 — toast bridge for the offline guard.
//
// guardOnline() (in useOnlineStatus) is dependency-free so it can run inside
// services. It signals an offline-blocked action via a window event; this
// component is the single place that turns that signal into a localized toast
// (it has toast + i18n access). Mount once, near the app root. Renders nothing.
// ============================================================

import { useEffect } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useTranslation } from '@/i18n';
import { OFFLINE_BLOCKED_EVENT } from '@/hooks/useOnlineStatus';

export default function OfflineGuardListener() {
  const { toast } = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    const handler = () => toast(t('offline.requiresInternet'), 'warning');
    window.addEventListener(OFFLINE_BLOCKED_EVENT, handler);
    return () => window.removeEventListener(OFFLINE_BLOCKED_EVENT, handler);
  }, [toast, t]);

  return null;
}
