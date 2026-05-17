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
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '6rem 1rem',
          textAlign: 'center',
          color: '#475569',
        }}
      >
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📋</div>
        <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.25rem', color: '#64748b' }}>
          No print jobs yet
        </div>
        <div style={{ fontSize: '0.8rem', color: '#334155' }}>Labels you print will appear here.</div>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.8rem', color: '#475569' }}>
          {jobs.length} job{jobs.length !== 1 ? 's' : ''}
        </span>
        {!confirmClear ? (
          <button
            onClick={() => setConfirmClear(true)}
            style={{
              fontSize: '0.72rem',
              color: '#f87171',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              opacity: 0.7,
            }}
          >
            Clear all
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.72rem', color: '#f87171', fontWeight: 500 }}>
              Delete all {jobs.length} jobs?
            </span>
            <button
              onClick={() => { onClearAll(); setConfirmClear(false); }}
              style={{
                fontSize: '0.72rem',
                padding: '0.2rem 0.6rem',
                background: 'rgba(239,68,68,0.15)',
                color: '#f87171',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Yes, clear
            </button>
            <button
              onClick={() => setConfirmClear(false)}
              style={{
                fontSize: '0.72rem',
                padding: '0.2rem 0.6rem',
                background: '#141e30',
                color: '#94a3b8',
                border: '1px solid rgba(148,163,184,0.15)',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
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
