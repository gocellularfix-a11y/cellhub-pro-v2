// ResponseCard — Phase 2 operational response renderer.
// Transforms plain chat responses into structured execution cards.
// Presentation-only: all action routing stays in IntelligenceChat.
import type { ChatActionUI } from '@/services/intelligence/chat/handlers';

// ── keyframe injection (once per app) ────────────────────────
const KF_ID = 'cellhub-response-card-kf';
function ensureKeyframes() {
  if (typeof document === 'undefined' || document.getElementById(KF_ID)) return;
  const s = document.createElement('style');
  s.id = KF_ID;
  s.textContent = `
@keyframes rcFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0);   }
}`;
  document.head.appendChild(s);
}

// ── action visual config ──────────────────────────────────────
type ExecutionTarget = string;

const TARGET_ICON: Record<string, string> = {
  whatsapp_url:       '📲',
  open_customer:      '👤',
  open_repair:        '🔧',
  open_layaway:       '📦',
  open_inventory:     '🗂️',
  open_promote_panel: '🚀',
  copy_to_clipboard:  '📋',
  add_to_operator_queue: '✅',
  pos_discount:       '🏷️',
  pos_bundle:         '📦',
  review_panel:       '🔍',
  reminder_queue:     '⏰',
  queue_manager_review: '📊',
};

// "Primary" targets get a more prominent button style.
const PRIMARY_TARGETS = new Set([
  'whatsapp_url',
  'open_customer',
  'open_repair',
  'open_layaway',
  'open_inventory',
  'open_promote_panel',
]);

// ── kind config ───────────────────────────────────────────────
const KIND_CFG: Record<string, { accent: string; badgeBg: string; badgeColor: string; badge: string }> = {
  answer:        { accent: '#3B82F6', badgeBg: '#1E3A5F', badgeColor: '#60A5FA', badge: 'INTEL' },
  disambiguation:{ accent: '#F59E0B', badgeBg: '#3D2B0A', badgeColor: '#FCD34D', badge: 'CLARIFY' },
  error:         { accent: '#EF4444', badgeBg: '#3B0B0B', badgeColor: '#FCA5A5', badge: 'ERROR' },
  help:          { accent: '#6B7280', badgeBg: '#1F2937', badgeColor: '#9CA3AF', badge: 'HELP' },
};

export interface ResponseCardProps {
  content: string;
  kind?: 'answer' | 'disambiguation' | 'error' | 'help';
  actions?: ChatActionUI[];
  onAction: (action: ChatActionUI) => void;
  feedbackById: Record<string, { message: string; ts: number }>;
  lang: string;
}

export default function ResponseCard({
  content,
  kind,
  actions,
  onAction,
  feedbackById,
  lang,
}: ResponseCardProps) {
  ensureKeyframes();

  const cfg = KIND_CFG[kind ?? 'answer'] ?? KIND_CFG.answer;

  // Split content into sections on double-newline.
  const paragraphs = content.split('\n\n').map(p => p.trim()).filter(Boolean);
  const [primary, ...rest] = paragraphs;

  // Partition actions: triggerQuery → chips; others → buttons by priority.
  const chipActions  = (actions ?? []).filter(a => a.triggerQuery && a.triggerQuery.trim());
  const execActions  = (actions ?? []).filter(a => !(a.triggerQuery && a.triggerQuery.trim()));
  const primaryExec  = execActions.filter(a => PRIMARY_TARGETS.has(a.payload.executionTarget));
  const secondaryExec = execActions.filter(a => !PRIMARY_TARGETS.has(a.payload.executionTarget));

  return (
    <div style={{
      borderRadius: 8,
      border: `1px solid ${cfg.accent}22`,
      borderLeft: `3px solid ${cfg.accent}`,
      background: '#0F1829',
      overflow: 'hidden',
      animation: 'rcFadeIn 0.18s ease-out',
      width: '100%',
    }}>
      {/* ── Header bar ── */}
      <div style={{
        padding: '6px 12px',
        borderBottom: '1px solid #1A2332',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 10, color: '#374151', fontWeight: 700, letterSpacing: '0.1em' }}>
          {cfg.badge}
        </span>
        {kind && kind !== 'answer' && (
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
            padding: '2px 7px', borderRadius: 99,
            background: cfg.badgeBg, color: cfg.badgeColor,
            border: `1px solid ${cfg.accent}33`,
          }}>
            {cfg.badge}
          </span>
        )}
      </div>

      {/* ── Content ── */}
      <div style={{ padding: '10px 14px' }}>
        {/* Primary section — first paragraph */}
        <div style={{
          fontSize: 13,
          color: '#E2E8F0',
          lineHeight: '1.55',
          whiteSpace: 'pre-wrap',
        }}>
          {primary}
        </div>

        {/* Additional sections — subsequent paragraphs */}
        {rest.map((p, i) => (
          <div key={i} style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: '1px solid #1A2332',
            fontSize: 12,
            color: '#94A3B8',
            lineHeight: '1.55',
            whiteSpace: 'pre-wrap',
          }}>
            {p}
          </div>
        ))}
      </div>

      {/* ── Actions ── */}
      {(primaryExec.length + secondaryExec.length + chipActions.length) > 0 && (
        <div style={{
          padding: '8px 12px 10px',
          borderTop: '1px solid #1A2332',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          alignItems: 'flex-start',
        }}>
          {/* Primary exec buttons */}
          {primaryExec.map(a => (
            <ExecButton
              key={a.id}
              action={a}
              isPrimary
              accent={cfg.accent}
              feedback={feedbackById[a.id]}
              onAction={onAction}
              lang={lang}
            />
          ))}
          {/* Secondary exec buttons */}
          {secondaryExec.map(a => (
            <ExecButton
              key={a.id}
              action={a}
              isPrimary={false}
              accent={cfg.accent}
              feedback={feedbackById[a.id]}
              onAction={onAction}
              lang={lang}
            />
          ))}
          {/* Chip-style trigger-query actions */}
          {chipActions.map(a => (
            <ChipButton
              key={a.id}
              action={a}
              feedback={feedbackById[a.id]}
              onAction={onAction}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Exec button: primary or secondary ────────────────────────
function ExecButton({
  action,
  isPrimary,
  accent,
  feedback,
  onAction,
  lang,
}: {
  action: ChatActionUI;
  isPrimary: boolean;
  accent: string;
  feedback?: { message: string; ts: number };
  onAction: (a: ChatActionUI) => void;
  lang: string;
}) {
  const icon = TARGET_ICON[action.payload.executionTarget] ?? '';
  const executable = action.payload.executable;
  const notExecTitle = lang === 'es'
    ? 'Datos faltantes para ejecutar'
    : lang === 'pt'
      ? 'Dados faltantes para executar'
      : 'Missing data to execute';

  return (
    <div>
      <button
        onClick={() => onAction(action)}
        disabled={!executable}
        title={executable ? undefined : notExecTitle}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: isPrimary ? '6px 13px' : '5px 11px',
          borderRadius: 6,
          fontSize: isPrimary ? 12 : 11,
          fontWeight: isPrimary ? 600 : 400,
          cursor: executable ? 'pointer' : 'not-allowed',
          opacity: executable ? 1 : 0.45,
          border: isPrimary
            ? `1px solid ${accent}55`
            : '1px solid rgba(71,85,105,0.5)',
          background: isPrimary
            ? `${accent}18`
            : 'rgba(15,24,41,0.6)',
          color: isPrimary ? accent : '#94A3B8',
          transition: 'background 0.1s, opacity 0.1s',
          whiteSpace: 'nowrap',
        }}
      >
        {icon && <span style={{ fontSize: 12, lineHeight: 1 }}>{icon}</span>}
        {action.label}
      </button>
      {feedback?.message && (
        <div style={{ marginTop: 3, fontSize: 11, color: '#6B7280' }}>
          {feedback.message}
        </div>
      )}
    </div>
  );
}

// ── Chip button: fires a triggerQuery follow-up ───────────────
function ChipButton({
  action,
  feedback,
  onAction,
}: {
  action: ChatActionUI;
  feedback?: { message: string; ts: number };
  onAction: (a: ChatActionUI) => void;
}) {
  return (
    <div>
      <button
        onClick={() => onAction(action)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 10px',
          borderRadius: 99,
          fontSize: 11,
          fontWeight: 400,
          color: '#64748B',
          border: '1px solid #1E2D3D',
          background: 'transparent',
          cursor: 'pointer',
          transition: 'color 0.1s, border-color 0.1s',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: 10 }}>↗</span>
        {action.label}
      </button>
      {feedback?.message && (
        <div style={{ marginTop: 3, fontSize: 11, color: '#6B7280' }}>
          {feedback.message}
        </div>
      )}
    </div>
  );
}
