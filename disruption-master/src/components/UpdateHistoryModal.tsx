import React, { useState } from 'react';
import { X, History, Edit3, Check, RotateCcw, User, Clock, ArrowRight } from 'lucide-react';
import { Disruption, DisruptionUpdateHistory } from '../types';
import { StatusBadge } from './StatusBadge';

interface UpdateHistoryModalProps {
  disruption: Disruption;
  currentUser: string;
  onClose: () => void;
  onDisruptionUpdated: (updated: Disruption) => void;
}

export const UpdateHistoryModal: React.FC<UpdateHistoryModalProps> = ({
  disruption,
  currentUser,
  onClose,
  onDisruptionUpdated,
}) => {
  const [editingUpdateId, setEditingUpdateId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEditing = (u: DisruptionUpdateHistory) => {
    setEditingUpdateId(u.updateId);
    setEditText(u.updateText);
    setError(null);
  };

  const cancelEditing = () => {
    setEditingUpdateId(null);
    setEditText('');
  };

  const handleSaveEdit = async (updateId: string) => {
    if (!editText.trim()) {
      setError('Update text cannot be blank.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/disruptions/${encodeURIComponent(disruption.disruptionId)}/updates/${encodeURIComponent(updateId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            editedText: editText.trim(),
            editedBy: currentUser || 'Operator',
          }),
        }
      );

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to update record');
      }

      const data = await res.json();
      onDisruptionUpdated(data.disruption);
      setEditingUpdateId(null);
      setEditText('');
    } catch (err: any) {
      setError(err.message || 'Error updating log');
    } finally {
      setIsSaving(false);
    }
  };

  const sortedHistory = [...(disruption.updateHistory || [])].reverse();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-slate-900 px-6 py-4 flex items-center justify-between border-b border-slate-800">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <History className="w-4 h-4 text-amber-400" />
              Disruption Live Update Audit Trail
            </h3>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              {disruption.disruptionId} — {disruption.outletId} ({disruption.storeName})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Overview Bar */}
        <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Current Status:</span>
            <StatusBadge status={disruption.currentStatus} />
          </div>
          <div className="flex items-center gap-4 text-slate-500">
            <span>
              Started: <strong className="text-slate-700">{disruption.disruptionStartDateTime}</strong>
            </span>
            <span>
              Last Updated By: <strong className="text-slate-700">{disruption.lastUpdatedBy}</strong>
            </span>
          </div>
        </div>

        {/* Audit Log Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
              {error}
            </div>
          )}

          {sortedHistory.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs">
              No live updates recorded yet.
            </div>
          ) : (
            <div className="space-y-4">
              {sortedHistory.map((u, index) => {
                const isEditing = editingUpdateId === u.updateId;

                return (
                  <div
                    key={u.updateId || index}
                    className="p-4 rounded-lg bg-white border border-slate-200 shadow-2xs transition hover:border-slate-300 space-y-2"
                  >
                    {/* Entry Header: Author, Time, Status Transition */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 text-slate-600">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-semibold text-slate-900">{u.updatedBy}</span>
                        <span className="text-slate-400">•</span>
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-mono text-slate-500">{u.updatedAt}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        {u.previousStatus && u.newStatus && (
                          <div className="flex items-center gap-1 text-[11px] bg-slate-100 px-2 py-0.5 rounded text-slate-600">
                            <span>{u.previousStatus}</span>
                            <ArrowRight className="w-3 h-3 text-slate-400" />
                            <span className="font-semibold text-slate-900">{u.newStatus}</span>
                          </div>
                        )}

                        {!isEditing && (
                          <button
                            type="button"
                            onClick={() => startEditing(u)}
                            className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-indigo-600 px-1.5 py-0.5 rounded hover:bg-indigo-50 transition"
                            title="Edit this update entry"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Edit</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Entry Text / Edit Mode */}
                    {isEditing ? (
                      <div className="space-y-2 pt-1">
                        <textarea
                          rows={3}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="w-full p-2 text-xs rounded border border-indigo-400 focus:ring-2 focus:ring-indigo-500 font-sans"
                        />
                        <div className="flex items-center justify-end gap-2 text-xs">
                          <button
                            type="button"
                            onClick={cancelEditing}
                            className="px-2.5 py-1 border border-slate-300 rounded text-slate-600 hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => handleSaveEdit(u.updateId)}
                            className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium flex items-center gap-1 disabled:opacity-50"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{isSaving ? 'Saving...' : 'Save Modification'}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-800 leading-relaxed font-normal whitespace-pre-wrap">
                        {u.updateText}
                      </p>
                    )}

                    {/* Audit Modification Details */}
                    {u.isEdited && (
                      <div className="pt-2 border-t border-slate-100 flex flex-col gap-1 text-[11px] text-amber-800 bg-amber-50/60 p-2 rounded">
                        <div className="flex items-center gap-1 font-medium">
                          <RotateCcw className="w-3 h-3 text-amber-600" />
                          <span>
                            Modified by {u.editedBy} at {u.editedAt}
                          </span>
                        </div>
                        {u.originalText && (
                          <span className="text-slate-500 italic">
                            Original: "{u.originalText}"
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-100 px-6 py-3 border-t border-slate-200 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-md transition"
          >
            Close Audit Log
          </button>
        </div>
      </div>
    </div>
  );
};
