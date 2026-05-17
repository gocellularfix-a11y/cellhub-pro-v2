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
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: CARD_PREVIEW_H,
          background: '#0a1120',
          backgroundImage: 'radial-gradient(rgba(148,163,184,0.06) 1px, transparent 1px)',
          backgroundSize: '12px 12px',
          borderRadius: '10px 10px 0 0',
        }}
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
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: CARD_PREVIEW_H,
        background: '#0a1120',
        backgroundImage: 'radial-gradient(rgba(148,163,184,0.06) 1px, transparent 1px)',
        backgroundSize: '12px 12px',
        borderRadius: '10px 10px 0 0',
      }}
    >
      <div style={{ width: displayW, height: displayH, position: 'relative' }}>
        <div
          className="absolute inset-0 rounded"
          style={{
            border: '1px solid #ddd',
            background: '#fff',
            boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
          }}
        />
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
    <div
      style={{
        background: 'linear-gradient(160deg, #0e1525 0%, #0b1120 100%)',
        borderRadius: '12px',
        border: '1px solid rgba(148,163,184,0.10)',
        overflow: 'hidden',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      {/* Mini preview — click opens detail modal */}
      <button style={{ width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }} onClick={() => onView(job)}>
        <MiniPreview job={job} />
      </button>

      {/* Info */}
      <div style={{ padding: '0.625rem 0.75rem' }}>
        <div
          style={{
            fontSize: '0.72rem',
            fontWeight: 600,
            color: '#cbd5e1',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            lineHeight: 1.3,
          }}
        >
          {displayName}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginTop: '0.375rem', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: '0.65rem',
              padding: '0.1rem 0.4rem',
              background: 'rgba(56,189,248,0.1)',
              color: '#38bdf8',
              borderRadius: '4px',
              fontWeight: 500,
              border: '1px solid rgba(56,189,248,0.2)',
            }}
          >
            {job.templateName}
          </span>
          <span style={{ fontSize: '0.65rem', color: '#475569' }}>{job.copies}×</span>
          {displayPrice && (
            <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#10b981' }}>{displayPrice}</span>
          )}
        </div>
        <div style={{ fontSize: '0.65rem', color: '#334155', marginTop: '0.25rem' }}>{formatDate(job.createdAt)}</div>
      </div>

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          borderTop: '1px solid rgba(148,163,184,0.08)',
        }}
      >
        <button
          onClick={() => onReprint(job)}
          title="Reprint"
          style={{
            flex: 1,
            padding: '0.5rem 0',
            fontSize: '0.7rem',
            color: '#64748b',
            background: 'none',
            border: 'none',
            borderRight: '1px solid rgba(148,163,184,0.08)',
            cursor: 'pointer',
            fontWeight: 500,
            transition: 'color 0.12s ease, background 0.12s ease',
          }}
        >
          🖨 Reprint
        </button>
        <button
          onClick={() => onEdit(job)}
          title="Duplicate / Edit"
          style={{
            flex: 1,
            padding: '0.5rem 0',
            fontSize: '0.7rem',
            color: '#64748b',
            background: 'none',
            border: 'none',
            borderRight: '1px solid rgba(148,163,184,0.08)',
            cursor: 'pointer',
            fontWeight: 500,
            transition: 'color 0.12s ease, background 0.12s ease',
          }}
        >
          ✏ Edit
        </button>
        <button
          onClick={() => onDelete(job.id)}
          title="Delete"
          style={{
            flex: 1,
            padding: '0.5rem 0',
            fontSize: '0.7rem',
            color: '#64748b',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontWeight: 500,
            transition: 'color 0.12s ease, background 0.12s ease',
          }}
        >
          🗑 Delete
        </button>
      </div>
    </div>
  );
}
