// ============================================================
// CellHub Pro — Inventory Field Customizer
// Modal for configuring which inventory fields are visible/required
// and defining custom fields (text/number/date/dropdown).
// ============================================================

import { useEffect, useState } from 'react';
import { Modal, ConfirmDialog } from '@/components/ui';
import { useTranslation } from '@/i18n';
import type {
  InventoryFieldConfig,
  CustomInventoryField,
  CustomFieldType,
  DefaultFieldToggle,
} from '@/store/types';

// ── Defaults & helpers ────────────────────────────────────

/**
 * Default config when nothing has been customized yet.
 * All built-in fields visible, Name/Category/Price required (hard-coded — Name is never toggleable).
 */
export const DEFAULT_FIELD_CONFIG: InventoryFieldConfig = {
  defaults: {
    sku:         { visible: true,  required: false },
    category:    { visible: true,  required: true  },
    condition:   { visible: true,  required: false },
    cost:        { visible: true,  required: false },
    price:       { visible: true,  required: true  },
    qty:         { visible: true,  required: false },
    supplier:    { visible: true,  required: false },
    brand:       { visible: true,  required: false },
    description: { visible: false, required: false },
  },
  customFields: [],
};

/** Returns a safe config merged with defaults */
export function resolveFieldConfig(
  cfg: InventoryFieldConfig | undefined,
): InventoryFieldConfig {
  if (!cfg) return DEFAULT_FIELD_CONFIG;
  return {
    defaults: { ...DEFAULT_FIELD_CONFIG.defaults, ...cfg.defaults },
    customFields: cfg.customFields || [],
  };
}

/** Check if a built-in field should be shown */
export function isFieldVisible(
  cfg: InventoryFieldConfig | undefined,
  field: keyof InventoryFieldConfig['defaults'],
): boolean {
  const resolved = resolveFieldConfig(cfg);
  return resolved.defaults[field]?.visible !== false;
}

export function isFieldRequired(
  cfg: InventoryFieldConfig | undefined,
  field: keyof InventoryFieldConfig['defaults'],
): boolean {
  const resolved = resolveFieldConfig(cfg);
  return resolved.defaults[field]?.required === true;
}

// ── Built-in field metadata (labels by language) ─────────

const BUILTIN_FIELDS: Array<{
  id: keyof InventoryFieldConfig['defaults'];
  labelEn: string;
  labelEs: string;
  labelPt: string;
  canBeRequired: boolean;
}> = [
  { id: 'sku',         labelEn: 'IMEI / SKU',    labelEs: 'IMEI / SKU',    labelPt: 'IMEI / SKU',      canBeRequired: true  },
  { id: 'category',    labelEn: 'Category',      labelEs: 'Categoría',     labelPt: 'Categoria',       canBeRequired: true  },
  { id: 'condition',   labelEn: 'Condition',     labelEs: 'Condición',     labelPt: 'Condição',        canBeRequired: false },
  { id: 'cost',        labelEn: 'Cost',          labelEs: 'Costo',         labelPt: 'Custo',           canBeRequired: false },
  { id: 'price',       labelEn: 'Price',         labelEs: 'Precio',        labelPt: 'Preço',           canBeRequired: true  },
  { id: 'qty',         labelEn: 'Quantity',      labelEs: 'Cantidad',      labelPt: 'Quantidade',      canBeRequired: false },
  { id: 'supplier',    labelEn: 'Supplier',      labelEs: 'Proveedor',     labelPt: 'Fornecedor',      canBeRequired: false },
  { id: 'brand',       labelEn: 'Brand',         labelEs: 'Marca',         labelPt: 'Marca',           canBeRequired: false },
  { id: 'description', labelEn: 'Description',   labelEs: 'Descripción',   labelPt: 'Descrição',       canBeRequired: false },
];

// ── The Modal ────────────────────────────────────────────

interface FieldCustomizerModalProps {
  open: boolean;
  onClose: () => void;
  config: InventoryFieldConfig;
  onSave: (config: InventoryFieldConfig) => void;
  lang: string;
}

export default function FieldCustomizerModal({
  open,
  onClose,
  config,
  onSave,
  lang,
}: FieldCustomizerModalProps) {
  const { t } = useTranslation();
  const builtinLabel = (f: typeof BUILTIN_FIELDS[number]): string =>
    lang === 'pt' ? f.labelPt : lang === 'es' ? f.labelEs : f.labelEn;

  // Local editable copy
  const [draft, setDraft] = useState<InventoryFieldConfig>(() => resolveFieldConfig(config));
  const [showAddField, setShowAddField] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);

  // Reset draft whenever modal opens or incoming config changes
  useEffect(() => {
    if (open) setDraft(resolveFieldConfig(config));
  }, [open, config]);

  const updateDefault = (
    fieldId: keyof InventoryFieldConfig['defaults'],
    patch: Partial<DefaultFieldToggle>,
  ) => {
    setDraft({
      ...draft,
      defaults: {
        ...draft.defaults,
        [fieldId]: { ...draft.defaults[fieldId], ...patch } as DefaultFieldToggle,
      },
    });
  };

  const handleAddField = (field: CustomInventoryField) => {
    setDraft({ ...draft, customFields: [...draft.customFields, field] });
    setShowAddField(false);
  };

  const handleUpdateField = (field: CustomInventoryField) => {
    setDraft({
      ...draft,
      customFields: draft.customFields.map((f) => (f.id === field.id ? field : f)),
    });
    setEditingFieldId(null);
  };

  const handleRemoveField = (id: string) => {
    setDraft({
      ...draft,
      customFields: draft.customFields.filter((f) => f.id !== id),
    });
  };

  const handleMoveField = (id: string, dir: -1 | 1) => {
    const idx = draft.customFields.findIndex((f) => f.id === id);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= draft.customFields.length) return;
    const copy = [...draft.customFields];
    [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
    setDraft({ ...draft, customFields: copy });
  };

  const handleSave = () => {
    onSave(draft);
    onClose();
  };

  const handleResetAll = () => {
    setDraft(DEFAULT_FIELD_CONFIG);
    setShowResetConfirm(false);
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={`⚙️ ${t('inventory.fields.title')}`}
        size="max-w-2xl"
      >
        <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: '0.5rem' }}>
          {/* Info banner */}
          <div style={{
            background: 'rgba(34,211,238,0.08)',
            border: '1px solid rgba(34,211,238,0.25)',
            borderRadius: '0.5rem',
            padding: '0.7rem 0.875rem',
            marginBottom: '1rem',
            fontSize: '0.78rem',
            color: '#a5f3fc',
            lineHeight: 1.5,
          }}>
            💡 {t('inventory.fields.infoBanner')}
          </div>

          {/* ── Built-in fields ── */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={sectionTitleStyle}>
              {t('inventory.fields.builtin')}
            </h3>
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '0.5rem',
              padding: '0.5rem',
            }}>
              {/* Name is always visible & required - shown but locked */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.5rem 0.6rem',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                opacity: 0.6,
              }}>
                <div style={{ fontSize: '0.82rem', color: '#e2e8f0', fontWeight: 500 }}>
                  🔒 {t('inventory.name')}
                  <span style={{ fontSize: '0.68rem', color: '#64748b', marginLeft: '0.5rem' }}>
                    ({t('inventory.fields.alwaysRequired')})
                  </span>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                  {t('inventory.fields.cannotDisable')}
                </div>
              </div>

              {BUILTIN_FIELDS.map((f) => {
                const state = draft.defaults[f.id] || { visible: true, required: false };
                return (
                  <div key={f.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.5rem 0.6rem',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: 1 }}>
                      <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="checkbox"
                          checked={state.visible !== false}
                          onChange={(e) => updateDefault(f.id, { visible: e.target.checked })}
                          style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                        />
                        <span style={{
                          fontSize: '0.82rem',
                          color: state.visible !== false ? '#e2e8f0' : '#64748b',
                          fontWeight: 500,
                        }}>
                          {builtinLabel(f)}
                        </span>
                      </label>
                    </div>
                    {f.canBeRequired && state.visible !== false && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={state.required === true}
                          onChange={(e) => updateDefault(f.id, { required: e.target.checked })}
                          style={{ width: '14px', height: '14px', cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                          {t('inventory.fields.required')}
                        </span>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Custom fields ── */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h3 style={{ ...sectionTitleStyle, marginBottom: 0 }}>
                {t('inventory.fields.custom')}
                <span style={{ fontSize: '0.7rem', color: '#64748b', marginLeft: '0.5rem', fontWeight: 400 }}>
                  ({draft.customFields.length})
                </span>
              </h3>
              <button
                onClick={() => setShowAddField(true)}
                style={primaryButtonStyle}
              >
                {t('inventory.fields.addField')}
              </button>
            </div>

            {draft.customFields.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '1.5rem',
                background: 'rgba(255,255,255,0.02)',
                border: '1px dashed rgba(255,255,255,0.1)',
                borderRadius: '0.5rem',
                fontSize: '0.78rem',
                color: '#64748b',
              }}>
                {t('inventory.fields.noCustom')}
              </div>
            ) : (
              <div style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '0.5rem',
                padding: '0.5rem',
              }}>
                {draft.customFields.map((field, idx) => (
                  <div key={field.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.6rem',
                    borderBottom: idx < draft.customFields.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                  }}>
                    <span style={{ fontSize: '1.1rem' }}>{typeIcon(field.type)}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.82rem', color: '#e2e8f0', fontWeight: 600 }}>
                        {lang === 'es' && field.labelEs ? field.labelEs : field.label}
                        {field.required && <span style={{ color: '#f87171', marginLeft: '0.25rem' }}>*</span>}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: '#64748b' }}>
                        {typeLabel(field.type, t)}
                        {field.type === 'dropdown' && field.options && ` · ${t('inventory.fields.options', field.options.length)}`}
                      </div>
                    </div>
                    <button
                      onClick={() => handleMoveField(field.id, -1)}
                      disabled={idx === 0}
                      style={{ ...iconButtonStyle, opacity: idx === 0 ? 0.3 : 1 }}
                      title={t('inventory.fields.moveUp')}
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => handleMoveField(field.id, 1)}
                      disabled={idx === draft.customFields.length - 1}
                      style={{ ...iconButtonStyle, opacity: idx === draft.customFields.length - 1 ? 0.3 : 1 }}
                      title={t('inventory.fields.moveDown')}
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => setEditingFieldId(field.id)}
                      style={iconButtonStyle}
                      title={t('inventory.edit')}
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleRemoveField(field.id)}
                      style={{ ...iconButtonStyle, color: '#f87171' }}
                      title={t('inventory.delete')}
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '0.5rem',
          marginTop: '1rem',
          paddingTop: '1rem',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}>
          <button
            onClick={() => setShowResetConfirm(true)}
            style={{
              padding: '0.5rem 0.875rem',
              borderRadius: '0.5rem',
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#fca5a5',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('inventory.fields.reset')}
          </button>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={onClose} className="btn btn-secondary">
              {t('inventory.form.cancel')}
            </button>
            <button onClick={handleSave} className="btn btn-primary">
              {t('inventory.form.save')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Add/Edit field modal */}
      {(showAddField || editingFieldId) && (
        <FieldEditorModal
          existing={editingFieldId ? draft.customFields.find((f) => f.id === editingFieldId) : undefined}
          onSave={(f) => {
            if (editingFieldId) handleUpdateField(f);
            else handleAddField(f);
          }}
          onClose={() => {
            setShowAddField(false);
            setEditingFieldId(null);
          }}
        />
      )}

      {/* Reset confirmation */}
      <ConfirmDialog
        open={showResetConfirm}
        title={t('inventory.fields.resetTitle')}
        message={t('inventory.fields.resetMsg')}
        variant="danger"
        confirmLabel={t('inventory.fields.resetConfirm')}
        cancelLabel={t('inventory.form.cancel')}
        onConfirm={handleResetAll}
        onCancel={() => setShowResetConfirm(false)}
      />
    </>
  );
}

// ── Field editor modal (add/edit single custom field) ────

interface FieldEditorModalProps {
  existing?: CustomInventoryField;
  onSave: (field: CustomInventoryField) => void;
  onClose: () => void;
}

function FieldEditorModal({ existing, onSave, onClose }: FieldEditorModalProps) {
  const { t } = useTranslation();
  const isEdit = !!existing;

  const [label, setLabel] = useState(existing?.label || '');
  const [labelEs, setLabelEs] = useState(existing?.labelEs || '');
  const [type, setType] = useState<CustomFieldType>(existing?.type || 'text');
  const [required, setRequired] = useState(existing?.required || false);
  const [placeholder, setPlaceholder] = useState(existing?.placeholder || '');
  const [optionsText, setOptionsText] = useState((existing?.options || []).join('\n'));

  const handleSubmit = () => {
    if (!label.trim()) return;
    const field: CustomInventoryField = {
      id: existing?.id || `cf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label: label.trim(),
      labelEs: labelEs.trim() || undefined,
      type,
      required,
      placeholder: placeholder.trim() || undefined,
    };
    if (type === 'dropdown') {
      const opts = optionsText.split('\n').map((o) => o.trim()).filter(Boolean);
      if (opts.length === 0) return;
      field.options = opts;
    }
    onSave(field);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit
        ? `✏️ ${t('inventory.fieldEditor.editField')}`
        : `➕ ${t('inventory.fieldEditor.newField')}`}
      size="max-w-md"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        {/* Label EN */}
        <div>
          <label style={labelStyle}>
            {t('inventory.fieldEditor.labelEn')} *
          </label>
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Color, Size, Serial Number"
            autoFocus
          />
        </div>

        {/* Label ES */}
        <div>
          <label style={labelStyle}>
            {t('inventory.fieldEditor.labelEs')}
          </label>
          <input
            className="input"
            value={labelEs}
            onChange={(e) => setLabelEs(e.target.value)}
            placeholder={t('inventory.fieldEditor.hintText')}
          />
        </div>

        {/* Type selector */}
        <div>
          <label style={labelStyle}>
            {t('inventory.fieldEditor.type')} *
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            {(['text', 'number', 'date', 'dropdown'] as CustomFieldType[]).map((fieldType) => (
              <button
                key={fieldType}
                onClick={() => setType(fieldType)}
                style={{
                  padding: '0.6rem',
                  borderRadius: '0.5rem',
                  border: type === fieldType ? '2px solid #22d3ee' : '1px solid rgba(255,255,255,0.1)',
                  background: type === fieldType ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.04)',
                  color: type === fieldType ? '#67e8f9' : '#cbd5e1',
                  fontSize: '0.82rem',
                  fontWeight: type === fieldType ? 700 : 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {typeIcon(fieldType)} {typeLabel(fieldType, t)}
              </button>
            ))}
          </div>
        </div>

        {/* Dropdown options */}
        {type === 'dropdown' && (
          <div>
            <label style={labelStyle}>
              {t('inventory.fieldEditor.optionsLabel')} *
            </label>
            <textarea
              className="input"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder={t('inventory.fieldEditor.optionsPlaceholder')}
              rows={5}
              style={{ resize: 'vertical', minHeight: '100px', fontFamily: 'inherit' }}
            />
          </div>
        )}

        {/* Placeholder */}
        {type !== 'date' && type !== 'dropdown' && (
          <div>
            <label style={labelStyle}>
              {t('inventory.fieldEditor.placeholderLabel')}
            </label>
            <input
              className="input"
              value={placeholder}
              onChange={(e) => setPlaceholder(e.target.value)}
              placeholder={t('inventory.fieldEditor.hintText')}
            />
          </div>
        )}

        {/* Required */}
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            style={{ width: '16px', height: '16px' }}
          />
          <span style={{ fontSize: '0.82rem', color: '#e2e8f0' }}>
            {t('inventory.fieldEditor.requiredField')}
          </span>
        </label>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
          <button onClick={onClose} className="btn btn-secondary">
            {t('inventory.form.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!label.trim() || (type === 'dropdown' && !optionsText.trim())}
            className="btn btn-primary"
          >
            {isEdit ? t('inventory.form.save') : `+ ${t('inventory.add')}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Helpers ──────────────────────────────────────────────

function typeIcon(type: CustomFieldType): string {
  switch (type) {
    case 'text':     return '🅰️';
    case 'number':   return '🔢';
    case 'date':     return '📅';
    case 'dropdown': return '📋';
  }
}

function typeLabel(type: CustomFieldType, t: (key: string) => string): string {
  return t(`inventory.fieldType.${type}`);
}

// ── Styles ───────────────────────────────────────────────

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '0.85rem',
  fontWeight: 700,
  color: '#e2e8f0',
  marginBottom: '0.5rem',
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.72rem',
  color: '#94a3b8',
  fontWeight: 600,
  marginBottom: '0.3rem',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '0.4rem 0.75rem',
  borderRadius: '0.4rem',
  background: 'rgba(34,211,238,0.15)',
  border: '1px solid rgba(34,211,238,0.35)',
  color: '#67e8f9',
  fontSize: '0.75rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const iconButtonStyle: React.CSSProperties = {
  padding: '0.35rem 0.5rem',
  borderRadius: '0.35rem',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#cbd5e1',
  fontSize: '0.78rem',
  cursor: 'pointer',
  flexShrink: 0,
};
