import { useEffect } from 'react';
import type { LabelJob } from '../../types';
import { formatPrice, formatDate, deriveBarcodeValue } from '../../utils';
import { LabelPreview } from '../LabelPreview';
import { CustomLabelPreview } from '../CustomLabelPreview';

interface JobDetailModalProps {
  job: LabelJob;
  onClose: () => void;
  onReprint: (job: LabelJob) => void;
  onEdit: (job: LabelJob) => void;
  onDelete: (id: string) => void;
}

export function JobDetailModal({ job, onClose, onReprint, onEdit, onDelete }: JobDetailModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  function handleDelete() { onDelete(job.id); onClose(); }
  function handleEdit() { onEdit(job); onClose(); }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">
              {job.isCustom ? 'Custom Label Job' : 'Label Job'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{formatDate(job.createdAt)}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
          >
            ×
          </button>
        </div>

        {/* Preview */}
        <div className="p-5 flex justify-center">
          {job.isCustom && job.customLabel ? (
            <CustomLabelPreview config={job.customLabel} maxWidth={380} maxHeight={260} />
          ) : job.product && job.templateId ? (
            <LabelPreview product={job.product} templateId={job.templateId} />
          ) : null}
        </div>

        {/* Details */}
        <div className="px-5 pb-4 grid grid-cols-2 gap-3 text-sm">
          {job.isCustom ? (
            <>
              <Detail label="Type" value="Custom Label" />
              <Detail label="Copies" value={`${job.copies}`} />
              <Detail
                label="Elements"
                value={`${job.customLabel?.elements.length ?? 0} element(s)`}
              />
              <Detail
                label="Size"
                value={
                  job.customLabel
                    ? `${job.customLabel.widthMm}×${job.customLabel.heightMm} mm`
                    : '—'
                }
              />
            </>
          ) : (
            <>
              <Detail label="Product" value={job.product?.name ?? '—'} />
              <Detail label="Price" value={job.product ? formatPrice(job.product.price) : '—'} />
              <Detail label="Template" value={job.templateName} />
              <Detail label="Copies" value={`${job.copies}`} />
              <Detail label="SKU" value={job.product?.sku ?? '—'} />
              <Detail
                label="Barcode / IMEI"
                value={job.product ? deriveBarcodeValue(job.product) : '—'}
              />
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={() => onReprint(job)}
            className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
          >
            🖨 Reprint {job.copies}×
          </button>
          <button
            onClick={handleEdit}
            className="flex-1 py-2.5 bg-amber-500 text-white text-sm font-semibold rounded-xl hover:bg-amber-600 transition-colors"
          >
            ✏ Duplicate / Edit
          </button>
          <button
            onClick={handleDelete}
            className="py-2.5 px-4 bg-red-50 text-red-600 text-sm font-semibold rounded-xl hover:bg-red-100 transition-colors"
          >
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500 font-medium mb-0.5">{label}</div>
      <div className="text-sm text-gray-900 font-semibold truncate">{value}</div>
    </div>
  );
}
