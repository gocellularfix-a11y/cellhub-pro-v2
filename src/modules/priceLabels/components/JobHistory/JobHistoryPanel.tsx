import { useState } from 'react';
import type { LabelJob } from '../../types';
import { JobCard } from './JobCard';
import { JobDetailModal } from './JobDetailModal';

interface JobHistoryPanelProps {
  jobs: LabelJob[];
  onReprint: (job: LabelJob) => void;
  onEdit: (job: LabelJob) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

export function JobHistoryPanel({
  jobs,
  onReprint,
  onEdit,
  onDelete,
  onClearAll,
}: JobHistoryPanelProps) {
  const [selectedJob, setSelectedJob] = useState<LabelJob | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center text-gray-400">
        <div className="text-5xl mb-4">📋</div>
        <div className="text-base font-semibold mb-1">No print jobs yet</div>
        <div className="text-sm">Labels you print will appear here.</div>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-500">{jobs.length} job{jobs.length !== 1 ? 's' : ''}</span>
        {!confirmClear ? (
          <button
            onClick={() => setConfirmClear(true)}
            className="text-xs text-red-500 hover:text-red-700 hover:underline"
          >
            Clear all
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-600 font-medium">Delete all {jobs.length} jobs?</span>
            <button
              onClick={() => { onClearAll(); setConfirmClear(false); }}
              className="text-xs px-2 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              Yes, clear
            </button>
            <button
              onClick={() => setConfirmClear(false)}
              className="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {jobs.map(job => (
          <JobCard
            key={job.id}
            job={job}
            onView={setSelectedJob}
            onReprint={onReprint}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>

      {/* Detail modal */}
      {selectedJob && (
        <JobDetailModal
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onReprint={job => { onReprint(job); setSelectedJob(null); }}
          onEdit={job => { onEdit(job); setSelectedJob(null); }}
          onDelete={id => { onDelete(id); setSelectedJob(null); }}
        />
      )}
    </div>
  );
}
