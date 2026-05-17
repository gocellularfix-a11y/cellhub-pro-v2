export const STATUS_LABELS = (t: (key: string) => string) => ({
  received:       t('status.received'),
  in_progress:    t('status.inProgress'),
  waiting_parts:  t('status.waitingParts'),
  ready:          t('status.ready'),
  picked_up:      t('status.pickedUp'),
  diagnosing:     t('status.diagnosing'),
  completed:      t('status.completed'),
  cancelled:      t('status.cancelled'),
  refund_pending: t('status.refundPending'),
  refunded:       t('status.refunded'),
});

export const PAYMENT_LABELS = (t: (key: string) => string) => ({
  cash:      t('payment.cash'),
  card:      t('payment.card'),
  financed:  t('payment.financed'),
  transfer:  t('payment.transfer'),
  split:     t('payment.split'),
});
