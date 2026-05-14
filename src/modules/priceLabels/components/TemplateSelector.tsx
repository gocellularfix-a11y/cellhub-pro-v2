import type { TemplateId } from '../types';
import { TEMPLATE_LIST } from '../templates';

interface TemplateSelectorProps {
  value: TemplateId;
  onChange: (id: TemplateId) => void;
}

export function TemplateSelector({ value, onChange }: TemplateSelectorProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Label Template</label>
      <div className="space-y-2">
        {TEMPLATE_LIST.map(template => {
          const selected = value === template.id;
          return (
            <button
              key={template.id}
              onClick={() => onChange(template.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                selected
                  ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                  selected ? 'border-blue-500 bg-blue-500' : 'border-gray-400'
                }`}
              >
                {selected && (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="w-1.5 h-1.5 bg-white rounded-full" />
                  </div>
                )}
              </div>
              <div>
                <div className={`text-sm font-semibold ${selected ? 'text-blue-700' : 'text-gray-800'}`}>
                  {template.name}
                </div>
                <div className="text-xs text-gray-500">{template.description}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
