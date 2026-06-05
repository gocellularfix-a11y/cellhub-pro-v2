// OperatorChatShell — Phase 1 shell
// Phase 3: store-avatar header, SuggestionChips (operational signals), command-bar input.
import IntelligenceChat from './IntelligenceChat';
import type { IntelligenceEngine } from '@/services/intelligence';
import type { Customer } from '@/store/types';
import type { PanelCampaignDraft } from '@/services/intelligence/chat/handlers';
import type { ChipData } from './SuggestionChips';

export interface OperatorChatShellProps {
  engine: IntelligenceEngine;
  customers: Customer[];
  lang: 'en' | 'es' | 'pt';
  externalQuery?: { text: string; seq: number };
  onOpenPromote?: (productId: string, productName: string) => void;
  onPanelCampaign?: (draft: PanelCampaignDraft) => void;
  chipData?: ChipData;
  compact?: boolean;
  hideInput?: boolean;
  clearSeq?: number;
}

export default function OperatorChatShell({
  engine,
  customers,
  lang,
  externalQuery,
  onOpenPromote,
  onPanelCampaign,
  chipData,
  compact,
  hideInput,
  clearSeq,
}: OperatorChatShellProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: compact ? 0 : 'calc(100vh - 7rem)', flex: compact ? 1 : undefined, overflow: 'hidden' }}>
      <IntelligenceChat
        engine={engine}
        customers={customers}
        lang={lang}
        externalQuery={externalQuery}
        onOpenPromote={onOpenPromote}
        onPanelCampaign={onPanelCampaign}
        chipData={chipData}
        compact={compact}
        hideInput={hideInput}
        clearSeq={clearSeq}
      />
    </div>
  );
}
