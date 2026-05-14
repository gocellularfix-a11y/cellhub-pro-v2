import { useState, useCallback } from 'react';
import type { LabelJob } from '../types';
import * as historyService from '../services/historyService';

export function useLabelHistory() {
  const [jobs, setJobs] = useState<LabelJob[]>(() => historyService.loadJobs());

  const addJob = useCallback((job: LabelJob) => {
    const updated = historyService.addJob(job);
    setJobs(updated);
  }, []);

  const deleteJob = useCallback((id: string) => {
    const updated = historyService.removeJob(id);
    setJobs(updated);
  }, []);

  const clearAll = useCallback(() => {
    historyService.clearAllJobs();
    setJobs([]);
  }, []);

  return { jobs, addJob, deleteJob, clearAll };
}
