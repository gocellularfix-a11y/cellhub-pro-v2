// ============================================================
// CellHub Pro — Quick Charge Modal
// ============================================================

import { useState } from 'react';
import { Modal } from '@/components/ui';
import { generateId } from '@/utils/dates';
import { normalizePhone } from '@/utils/normalize';
import { useTranslation } from '@/i18n';
import type { CartItem } from '@/store/types';

interface QuickChargeModalProps {
  open: boolean;
  onClose: () => void;
  cart: CartItem[];
  setCart: (cart: CartItem[]) => void;
  lang: string;
  L: Record<string, any>;
}

export default function QuickChargeModal({
  open,
  onClose,
  cart,
  setCart,
  lang,
  L,
}: QuickChargeModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: '',
    firstName: '',
    lastName: '',
    phone: '',
    price: '',
    imei: '',
    comments: '',
    taxMode: 'none' as 'none' | 'sales' | 'phone_payment',
  });

  const reset = () => {
    setForm({ name: '', firstName: '', lastName: '', phone: '', price: '', imei: '', comments: '', taxMode: 'none' });
  };

  const handleSubmit = () => {
    const name = form.name.trim();
    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const price = parseFloat(form.price);

    if (!name || !firstName || !lastName || !price || price <= 0) return;

    // IMEI validation
    if (form.imei && form.imei.replace(/\D/g, '').length !== 15) return;

    const taxable = form.taxMode === 'sales';
    const customerFullName = `${firstName} ${lastName}`.trim();
    let notes = `Customer: ${customerFullName}`;
    if (form.comments.trim()) notes += ` | ${form.comments.trim()}`;

    const newItem: CartItem = {
      id: generateId(),
      name,
      category: form.taxMode === 'phone_payment' ? 'phone_payment' : 'service',
      price: Math.round(price * 100), // cents
      qty: 1,
      taxable,
      cbeEligible: false,
      notes,
      phoneNumber: normalizePhone(form.phone),
    };

    setCart([...cart, newItem]);
    reset();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={`⚡ ${t('quickCharge')}`} size="max-w-md">
      <div className="space-y-3">
        {/* Service name */}
        <div>
          <label className="text-sm text-slate-400 block mb-1">
            {t('servicesTitle')}
          </label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t('exampleService')}
            className="input"
            autoFocus
          />
        </div>

        {/* Customer name */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-slate-400 block mb-1">{t('quickChargeModal.firstName')}</label>
            <input
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className="input"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400 block mb-1">{t('quickChargeModal.lastName')}</label>
            <input
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className="input"
            />
          </div>
        </div>

        {/* Phone */}
        <div>
          <label className="text-sm text-slate-400 block mb-1">{t('quickChargeModal.phoneOptional')}</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="(555) 123-4567"
            className="input"
          />
        </div>

        {/* Price */}
        <div>
          <label className="text-sm text-slate-400 block mb-1">{t('payment')} ($)</label>
          <input
            type="number"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            placeholder="0.00"
            className="input text-lg"
            step="0.01"
            min="0"
          />
        </div>

        {/* IMEI */}
        <div>
          <label className="text-sm text-slate-400 block mb-1">{t('quickChargeModal.imeiOptional')}</label>
          <input
            value={form.imei}
            onChange={(e) => setForm({ ...form, imei: e.target.value })}
            placeholder={t('quickChargeModal.imeiPlaceholder')}
            maxLength={15}
            className="input"
          />
        </div>

        {/* Tax mode */}
        <div>
          <label className="text-sm text-slate-400 block mb-1">{t('taxType')}</label>
          <select
            value={form.taxMode}
            onChange={(e) => setForm({ ...form, taxMode: e.target.value as typeof form.taxMode })}
            className="select"
          >
            <option value="none">{t('noTaxServices')}</option>
            <option value="sales">{t('salesTaxPhonesAccessories')}</option>
            <option value="phone_payment">{t('phonePaymentTaxes')}</option>
          </select>
        </div>

        {/* Comments */}
        <div>
          <label className="text-sm text-slate-400 block mb-1">{t('quickChargeModal.comments')}</label>
          <textarea
            value={form.comments}
            onChange={(e) => setForm({ ...form, comments: e.target.value })}
            className="textarea"
            rows={2}
          />
        </div>

        <button onClick={handleSubmit} className="btn btn-primary w-full mt-2">
          {t('addToCart')} →
        </button>
      </div>
    </Modal>
  );
}
