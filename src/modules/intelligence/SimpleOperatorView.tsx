// SimpleOperatorView — Phase 7 Option-2 command center.
// Full-width single surface: action cards → chat. No split panels.
import type { IntelligenceEngine } from '@/services/intelligence';
import type { Customer } from '@/store/types';
import type { ChipData } from './SuggestionChips';
import type { PanelCampaignDraft } from '@/services/intelligence/chat/handlers';
import OperatorChatShell from './OperatorChatShell';

interface SimpleOperatorViewProps {
  engine: IntelligenceEngine;
  customers: Customer[];
  lang: 'en' | 'es';
  externalQuery?: { text: string; seq: number };
  onOpenPromote?: (productId: string, productName: string) => void;
  onPanelCampaign?: (draft: PanelCampaignDraft) => void;
  chipData: ChipData;
}

export default function SimpleOperatorView({
  engine,
  customers,
  lang,
  externalQuery,
  onOpenPromote,
  onPanelCampaign,
  chipData,
}: SimpleOperatorViewProps) {
  return (
    <OperatorChatShell
      engine={engine}
      customers={customers}
      lang={lang}
      externalQuery={externalQuery}
      onOpenPromote={onOpenPromote}
      onPanelCampaign={onPanelCampaign}
      chipData={chipData}
      compact
    />
  );
}
