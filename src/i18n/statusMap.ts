export const STATUS_LABELS = (t: (key: string) => string) => ({
  received:       t('status.received'),
  in_progress:    t('status.inProgress'),
  waiting_parts:  t('status.waitingParts'),
  ready:          t('status.ready'),
  completed:      t('status.completed'),
  cancelled:      t('status.cancelled'),
  refund_pending: t('status.refundPending'),
  refunded:       t('status.refunded'),
});
