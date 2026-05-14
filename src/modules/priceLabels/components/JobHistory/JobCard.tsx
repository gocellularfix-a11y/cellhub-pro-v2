import type { LabelJob, TemplateId } from '../../types';
import { formatPrice, formatDate, mmToPx, deriveBarcodeValue } from '../../utils';
import { TEMPLATE_REGISTRY } from '../../templates';
import { CustomLabelPreview } from '../CustomLabelPreview';

const CARD_PREVIEW_W = 160;
const CARD_PREVIEW_H = 100;

interface JobCardProps {
  job: LabelJob;
  onView: (job: LabelJob) => void;
  onReprint: (job: LabelJob) => void;
  onEdit: (job: LabelJob) => void;
  onDelete: (id: string) => void;
}

function MiniPreview({ job }: { job: LabelJob }) {
  // Custom label
  if (job.isCustom && job.customLabel) {
    return (
      <div
        className="flex items-center justify-center bg-gray-50 rounded-t-xl"
        style={{ height: CARD_PREVIEW_H }}
      >
        <CustomLabelPreview
          config={job.customLabel}
          maxWidth={CARD_PREVIEW_W}
          maxHeight={CARD_PREVIEW_H - 8}
        />
      </div>
    );
  }

  // Product-template label
  if (!job.templateId || !job.product) return null;
  const template = TEMPLATE_REGISTRY[job.templateId as TemplateId];
  if (!template) return null;
  const LabelComponent = template.component;
  const labelW = mmToPx(template.widthMm);
  const labelH = mmToPx(template.heightMm);
  const scale = Math.min(CARD_PREVIEW_W / labelW, CARD_PREVIEW_H / labelH);
  const displayW = Math.round(labelW * scale);
  const displayH = Math.round(labelH * scale);
  const barcodeValue = deriveBarcodeValue(job.product);

  return (
    <div className="flex items-center justify-center bg-gray-50 rounded-t-xl" style={{ height: CARD_PREVIEW_H }}>
      <div style={{ width: displayW, height: displayH, position: 'relative' }}>
        <div className="absolute inset-0 shadow rounded" style={{ border: '1px solid #ddd', background: '#fff' }} />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transformOrigin: 'top left',
            transform: `scale(${scale})`,
            pointerEvents: 'none',
          }}
        >
          <LabelComponent product={job.product} barcodeValue={barcodeValue} />
        </div>
      </div>
    </div>
  );
}

export function JobCard({ job, onView, onReprint, onEdit, onDelete }: JobCardProps) {
  const displayName = job.isCustom
    ? 'Custom Label'
    : job.product?.name ?? '—';

  const displayPrice = job.product ? formatPrice(job.product.price) : null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
      {/* Mini preview — click opens detail modal */}
      <button className="w-full" onClick={() => onView(job)}>
        <MiniPreview job={job} />
      </button>

      {/* Info */}
      <div className="p-3">
        <div className="text-xs font-semibold text-gray-800 truncate leading-tight">{displayName}</div>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">
            {job.templateName}
          </span>
          <span className="text-xs text-gray-500">{job.copies}×</span>
          {displayPrice && (
            <span className="text-xs font-semibold text-emerald-700">{displayPrice}</span>
          )}
        </div>
        <div className="text-xs text-gray-400 mt-1">{formatDate(job.createdAt)}</div>
      </div>

      {/* Actions */}
      <div className="flex border-t border-gray-100 divide-x divide-gray-100">
        <button
          onClick={() => onReprint(job)}
          title="Reprint"
          className="flex-1 py-2 text-xs text-gray-600 hover:bg-blue-50 hover:text-blue-700 transition-colors font-medium"
        >
          🖨 Reprint
        </button>
        <button
          onClick={() => onEdit(job)}
          title="Duplicate / Edit"
          className="flex-1 py-2 text-xs text-gray-600 hover:bg-amber-50 hover:text-amber-700 transition-colors font-medium"
        >
          ✏ Edit
        </button>
        <button
          onClick={() => onDelete(job.id)}
          title="Delete"
          className="flex-1 py-2 text-xs text-gray-600 hover:bg-red-50 hover:text-red-700 transition-colors font-medium"
        >
          🗑 Delete
        </button>
      </div>
    </div>
  );
}
