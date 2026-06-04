// Companion — Background runtime mount.
//
// Invisible component mounted at AppShell level. Owns the global
// polling loop that catches inbound activity (manager messages +
// approval responses) regardless of which sidebar tab the operator
// is on. Routes notifications to toast / bubble / badge per tab.

import { useEffect, useRef } from 'react';
import { useApp } from '@/store/AppProvider';
import { useToast } from '@/components/ui/Toast';
import { useTranslation } from '@/i18n';
import {
  startCompanionRuntime,
  stopCompanionRuntime,
} from '@/services/companion/runtime';

export default function CompanionRuntimeMount() {
  const { state: { activeTab } } = useApp();
  const { toast } = useToast();
  const { t } = useTranslation();
  // Refs keep the runtime callbacks reading FRESH activeTab / toast / t each
  // poll. Without these, the closure captured at startup would freeze
  // those values forever.
  const activeTabRef = useRef(activeTab);
  const toastRef = useRef(toast);
  const tRef = useRef(t);
  activeTabRef.current = activeTab;
  toastRef.current = toast;
  tRef.current = t;

  useEffect(() => {
    startCompanionRuntime({
      getActiveTab: () => activeTabRef.current,
      toast: (msg, type) => toastRef.current(msg, type),
      // R-COMPANION-I18N-FULL-V1: localize inbound-activity toasts.
      t: (key, ...args) => tRef.current(key, ...args),
    });
    return () => stopCompanionRuntime();
  }, []);

  return null;
}
