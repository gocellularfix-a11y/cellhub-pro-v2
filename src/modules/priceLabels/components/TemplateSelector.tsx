import type { TemplateId } from '../types';
import { TEMPLATE_LIST } from '../templates';

interface TemplateSelectorProps {
  value: TemplateId;
  onChange: (id: TemplateId) => void;
}

export function TemplateSelector({ value, onChange }: TemplateSelectorProps) {
  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: '0.75rem',
          fontWeight: 500,
          color: '#64748b',
          marginBottom: '0.5rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        Label Template
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {TEMPLATE_LIST.map(template => {
          const selected = value === template.id;
          return (
            <button
              key={template.id}
              onClick={() => onChange(template.id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.625rem 0.75rem',
                borderRadius: '10px',
                border: selected
                  ? '1px solid rgba(56,189,248,0.35)'
                  : '1px solid rgba(148,163,184,0.10)',
                background: selected ? 'rgba(56,189,248,0.08)' : 'rgba(20,30,48,0.5)',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.12s ease',
                borderLeft: selected ? '3px solid #38bdf8' : '1px solid rgba(148,163,184,0.10)',
              }}
            >
              <div
                style={{
                  width: '1rem',
                  height: '1rem',
                  borderRadius: '50%',
                  border: selected ? '2px solid #38bdf8' : '2px solid #334155',
                  background: selected ? '#38bdf8' : 'transparent',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.12s ease',
                }}
              >
                {selected && (
                  <div
                    style={{
                      width: '0.375rem',
                      height: '0.375rem',
                      background: '#000',
                      borderRadius: '50%',
                    }}
                  />
                )}
              </div>
              <div>
                <div
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: selected ? '#38bdf8' : '#cbd5e1',
                    lineHeight: 1.3,
                  }}
                >
                  {template.name}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: '0.1rem' }}>
                  {template.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
