// CellHub Intelligence — Module Container
//
// Instantiates IntelligenceEngine from AppState data and renders the dashboard.
// Lives at activeTab === 'intelligence'.

import { useMemo, useState, useCallback } from 'react';
import { useApp } from '@/store/AppProvider';
import { IntelligenceEngine, type EngineResult } from '@/services/intelligence';
import IntelligenceDashboard from '@/components/ui/IntelligenceDashboard';

export default function IntelligenceModule() {
  const { state } = useApp();
  const { sales, customers, inventory, repairs, lang, currentStoreId, consolidatedView } = state;

  // Force-refresh trigger — bumped by onRefresh to recompute.
  const [refreshKey, setRefreshKey] = useState(0);

  // Instantiate engine + run analysis. Memoized on data + refresh key.
  // The schema adapter runs inside the engine constructor, so we pass raw data.
  const result: EngineResult = useMemo(() => {
    const engine = new IntelligenceEngine(
      sales,
      customers,
      inventory,
      repairs,
      {
        lang: (lang === 'es' ? 'es' : 'en'),
        storeId: consolidatedView ? undefined : currentStoreId,
        enableAlerts: true,
        enableScoring: true,
        cacheTimeoutMinutes: 15,
      }
    );
    return engine.analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, customers, inventory, repairs, lang, currentStoreId, consolidatedView, refreshKey]);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <IntelligenceDashboard
      report={result.report}
      healthScore={result.healthScore}
      kpiDashboard={result.kpiDashboard}
      insights={result.insights}
      lang={lang === 'es' ? 'es' : 'en'}
      onRefresh={handleRefresh}
    />
  );
}
