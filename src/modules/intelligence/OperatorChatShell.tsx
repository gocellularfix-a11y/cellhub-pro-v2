// OperatorChatShell — Phase 1 shell
// Phase 3: store-avatar header, SuggestionChips (operational signals), command-bar input.
import IntelligenceChat from './IntelligenceChat';
import type { IntelligenceEngine } from '@/services/intelligence';
import type { Customer } from '@/store/types';
import type { PanelCampaignDraft } from '@/services/intelligence/chat/handlers';

export interface OperatorChatShellProps {
  engine: IntelligenceEngine;
  customers: Customer[];
  lang: 'en' | 'es';
  externalQuery?: { text: string; seq: number };
  onOpenPromote?: (productId: string, productName: string) => void;
  onPanelCampaign?: (draft: PanelCampaignDraft) => void;
}

export default function OperatorChatShell({
  engine,
  customers,
  lang,
  externalQuery,
  onOpenPromote,
  onPanelCampaign,
}: OperatorChatShellProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 7rem)', overflow: 'hidden' }}>
      <IntelligenceChat
        engine={engine}
        customers={customers}
        lang={lang}
        externalQuery={externalQuery}
        onOpenPromote={onOpenPromote}
        onPanelCampaign={onPanelCampaign}
      />
    </div>
  );
}
