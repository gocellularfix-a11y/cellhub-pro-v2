// ResponseCard — Phase 2 operational response renderer.
// Transforms plain chat responses into structured execution cards.
// Presentation-only: all action routing stays in IntelligenceChat.
import { memo } from 'react';
import type { ChatActionUI, WorkflowSection } from '@/services/intelligence/chat/handlers';

// ── keyframe injection (once per app) ────────────────────────
const KF_ID = 'cellhub-response-card-kf';
function ensureKeyframes() {
  if (typeof document === 'undefined' || document.getElementById(KF_ID)) return;
  const s = document.createElement('style');
  s.id = KF_ID;
  s.textContent = `
@keyframes rcFadeIn {
  from { opacity: 0; transform: translateY(3px); }
  to   { opacity: 1; transform: translateY(0);   }
}`;
  document.head.appendChild(s);
}

const TARGET_ICON: Record<string, string> = {
  whatsapp_url:          '📲',
  open_customer:         '👤',
  open_repair:           '🔧',
  open_layaway:          '📦',
  open_inventory:        '🗂️',
  open_promote_panel:    '🚀',
  copy_to_clipboard:     '📋',
  add_to_operator_queue: '✅',
  pos_discount:          '🏷️',
  pos_bundle:            '📦',
  review_panel:          '🔍',
  reminder_queue:        '⏰',
  queue_manager_review:  '📊',
};

const PRIMARY_TARGETS = new Set([
  'whatsapp_url',
  'open_customer',
  'open_repair',
  'open_layaway',
  'open_inventory',
  'open_promote_panel',
]);

const KIND_CFG: Record<string, { accent: string; badgeBg: string; badgeColor: string; badge: string }> = {
  answer:         { accent: '#3B82F6', badgeBg: '#1E3A5F', badgeColor: '#60A5FA', badge: 'INTEL' },
  disambiguation: { accent: '#F59E0B', badgeBg: '#3D2B0A', badgeColor: '#FCD34D', badge: 'CLARIFY' },
  error:          { accent: '#EF4444', badgeBg: '#3B0B0B', badgeColor: '#FCA5A5', badge: 'ERROR' },
  help:           { accent: '#6B7280', badgeBg: '#1F2937', badgeColor: '#9CA3AF', badge: 'HELP' },
};

export interface ResponseCardProps {
  content: string;
  kind?: 'answer' | 'disambiguation' | 'error' | 'help';
  actions?: ChatActionUI[];
  workflowSections?: WorkflowSection[];
  onAction: (action: ChatActionUI) => void;
  feedbackById: Record<string, { message: string; ts: number }>;
  lang: string;
}

function ResponseCard({
  content,
  kind,
  actions,
  workflowSections,
  onAction,
  feedbackById,
  lang,
}: ResponseCardProps) {
  ensureKeyframes();

  const cfg = KIND_CFG[kind ?? 'answer'] ?? KIND_CFG.answer;
  const isAnswer = !kind || kind === 'answer';

  const paragraphs = content.split('\n\n').map(p => p.trim()).filter(Boolean);
  const [primary, ...rest] = paragraphs;

  const chipActions   = (actions ?? []).filter(a => a.triggerQuery && a.triggerQuery.trim());
  const execActions   = (actions ?? []).filter(a => !(a.triggerQuery && a.triggerQuery.trim()));
  const primaryExec   = execActions.filter(a => PRIMARY_TARGETS.has(a.payload.executionTarget));
  const secondaryExec = execActions.filter(a => !PRIMARY_TARGETS.has(a.payload.executionTarget));
  const hasActions    = (primaryExec.length + secondaryExec.length + chipActions.length) > 0;

  return (
    <div style={{
      borderRadius: 18,
      background: '#171f2a',
      border: `1px solid rgba(255,255,255,0.07)`,
      borderLeft: `3px solid ${cfg.accent}`,
      padding: 18,
      animation: 'rcFadeIn 0.16s ease-out',
      width: '100%',
    }}>
      {/* Badge — only for non-answer kinds (disambiguation, error, help) */}
      {!isAnswer && (
        <div style={{ marginBottom: 10 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.09em',
            padding: '2px 7px', borderRadius: 99,
            background: cfg.badgeBg, color: cfg.badgeColor,
            border: `1px solid ${cfg.accent}33`,
          }}>
            {cfg.badge}
          </span>
        </div>
      )}

      {/* Content */}
      <div style={{
        fontSize: 14,
        color: '#d1d5db',
        lineHeight: '1.7',
        whiteSpace: 'pre-wrap',
      }}>
        {primary}
      </div>
      {rest.map((p, i) => (
        <div key={i} style={{
          marginTop: 10,
          fontSize: 14,
          color: '#d1d5db',
          lineHeight: '1.7',
          whiteSpace: 'pre-wrap',
        }}>
          {p}
        </div>
      ))}

      {/* Workflow Sections */}
      {workflowSections && workflowSections.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {workflowSections.map((section, si) => (
            <WorkflowSectionBlock key={si} section={section} />
          ))}
        </div>
      )}

      {/* Actions */}
      {hasActions && (
        <div style={{
          marginTop: 18,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'flex-start',
        }}>
          {primaryExec.map(a => (
            <ExecButton key={a.id} action={a} isPrimary accent={cfg.accent} feedback={feedbackById[a.id]} onAction={onAction} lang={lang} />
          ))}
          {secondaryExec.map(a => (
            <ExecButton key={a.id} action={a} isPrimary={false} accent={cfg.accent} feedback={feedbackById[a.id]} onAction={onAction} lang={lang} />
          ))}
          {chipActions.map(a => (
            <ChipButton key={a.id} action={a} feedback={feedbackById[a.id]} onAction={onAction} />
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(ResponseCard);

// ── Exec button ───────────────────────────────────────────────
function ExecButton({
  action, isPrimary, accent, feedback, onAction, lang,
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
  const notExecTitle = lang === 'es' ? 'Datos faltantes para ejecutar'
    : lang === 'pt' ? 'Dados faltantes para executar'
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
          padding: isPrimary ? '8px 14px' : '7px 12px',
          borderRadius: 10,
          fontSize: 13,
          fontWeight: isPrimary ? 600 : 500,
          cursor: executable ? 'pointer' : 'not-allowed',
          opacity: executable ? 1 : 0.4,
          border: isPrimary ? `1px solid ${accent}55` : '1px solid rgba(255,255,255,0.10)',
          background: isPrimary ? `${accent}22` : '#232d3b',
          color: isPrimary ? accent : '#e2e8f0',
          transition: 'opacity 0.1s',
          whiteSpace: 'nowrap',
        }}
      >
        {icon && <span style={{ fontSize: 12, lineHeight: 1 }}>{icon}</span>}
        {action.label}
      </button>
      {feedback?.message && (
        <div style={{ marginTop: 3, fontSize: 11, color: '#6B7280' }}>{feedback.message}</div>
      )}
    </div>
  );
}

// ── Chip button ───────────────────────────────────────────────
function ChipButton({
  action, feedback, onAction,
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
          padding: '7px 12px',
          borderRadius: 10,
          fontSize: 12,
          fontWeight: 500,
          color: '#94a3b8',
          border: '1px solid rgba(255,255,255,0.10)',
          background: '#232d3b',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontSize: 10 }}>↗</span>
        {action.label}
      </button>
      {feedback?.message && (
        <div style={{ marginTop: 3, fontSize: 11, color: '#6B7280' }}>{feedback.message}</div>
      )}
    </div>
  );
}

// ── Workflow section block ────────────────────────────────────
function WorkflowSectionBlock({ section }: { section: WorkflowSection }) {
  const accent = section.accent ?? '#6B7280';
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 7 }}>
        {section.icon && <span style={{ fontSize: 11, lineHeight: 1 }}>{section.icon}</span>}
        <span style={{
          fontSize: 10, fontWeight: 700, color: accent,
          letterSpacing: '0.08em', textTransform: 'uppercase' as const,
        }}>
          {section.title}
        </span>
      </div>
      {section.rows?.map((row, ri) => (
        <div key={ri} style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '6px 0',
          borderTop: ri > 0 ? '1px solid #141E2E' : undefined,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, color: '#C4CDD9', fontWeight: 500, lineHeight: '1.3' }}>
              {row.label}
            </div>
            {row.meta && (
              <div style={{ fontSize: 11, color: '#5A6880', marginTop: 2, lineHeight: '1.3' }}>
                {row.meta}
              </div>
            )}
          </div>
          {row.badge && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
              padding: '2px 6px', borderRadius: 99,
              background: `${row.badgeAccent ?? '#6B7280'}1A`,
              color: row.badgeAccent ?? '#6B7280',
              border: `1px solid ${row.badgeAccent ?? '#6B7280'}33`,
              flexShrink: 0, marginLeft: 10, marginTop: 1,
              whiteSpace: 'nowrap' as const,
            }}>
              {row.badge}
            </span>
          )}
        </div>
      ))}
      {section.summary && (
        <div style={{ fontSize: 11, color: '#4B5563', marginTop: 6 }}>
          {section.summary}
        </div>
      )}
    </div>
  );
}
