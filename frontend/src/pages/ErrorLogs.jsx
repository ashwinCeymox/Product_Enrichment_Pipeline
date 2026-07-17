import React, { useState, useEffect, useRef } from 'react';
import api from '../api/client';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Clock, ServerCrash, XCircle, CheckCircle2, Trash2, Calendar, RefreshCcw } from 'lucide-react';
import clsx from 'clsx';

export default function ErrorLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [searchParams] = useSearchParams();
  const targetTaskId = searchParams.get('taskId');
  const [scrolled, setScrolled] = useState(false);
  const taskRefs = useRef({});
  
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleTask, setRescheduleTask] = useState(null);
  const [rescheduleType, setRescheduleType] = useState('now'); // 'now' or 'later'
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleLoading, setRescheduleLoading] = useState(false);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const res = await api.get('/dashboard/error-logs?limit=100');
      const allLogs = res.data.items || [];
      const clearedTimestamp = parseInt(localStorage.getItem('clearedErrorsTimestamp') || '0', 10);
      const visibleLogs = allLogs.filter(log => new Date(log.created_at).getTime() > clearedTimestamp);
      setLogs(visibleLogs);
      setError('');
    } catch (err) {
      console.error('Failed to fetch error logs:', err);
      setError('Failed to load error logs. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClearLogs = () => {
    localStorage.setItem('clearedErrorsTimestamp', Date.now().toString());
    setLogs([]);
    window.dispatchEvent(new Event('errorLogsCleared'));
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    if (targetTaskId && logs.length > 0 && !scrolled) {
      if (taskRefs.current[targetTaskId]) {
        taskRefs.current[targetTaskId].scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        alert("This task is no longer available.");
      }
      setScrolled(true);
    }
  }, [logs, targetTaskId, scrolled]);

  const handleOpenReschedule = (log) => {
    setRescheduleTask(log);
    setRescheduleType('now');
    setRescheduleDate('');
    setShowRescheduleModal(true);
  };

  const handleRescheduleSubmit = async () => {
    if (!rescheduleTask) return;
    if (rescheduleType === 'later' && !rescheduleDate) {
      alert("Please select a date to schedule.");
      return;
    }
    
    setRescheduleLoading(true);
    try {
      await api.post('/jobs', {
        task_name: rescheduleTask.task_name,
        urls: [rescheduleTask.source_url],
        priority: 'medium', // Default
        scheduled_date: rescheduleType === 'later' ? rescheduleDate : null,
        product_type: 'simple', // Default
        created_by: 'admin'
      });
      
      // Remove the old failed task from the backend
      try {
        await api.delete(`/jobs/${rescheduleTask.job_id}`);
      } catch (e) {
        console.error("Failed to delete old job:", e);
      }
      
      // Update local state to remove the log
      setLogs(prev => prev.filter(log => log.job_id !== rescheduleTask.job_id));
      
      alert(`Task rescheduled successfully for ${rescheduleType === 'now' ? 'immediate execution' : rescheduleDate}.`);
      setShowRescheduleModal(false);
      setRescheduleTask(null);
    } catch (err) {
      console.error(err);
      alert('Failed to reschedule task.');
    } finally {
      setRescheduleLoading(false);
    }
  };

  if (loading && logs.length === 0) {
    return (
      <div className="flex justify-center items-center h-[calc(100vh-6rem)]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Error Logs</h1>
          <p className="text-sm text-slate-500 mt-1">Review recently failed or aborted pipeline tasks.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={handleClearLogs}
            disabled={logs.length === 0}
            className="flex items-center gap-2 text-sm font-medium text-rose-600 bg-rose-50 border border-rose-200 hover:bg-rose-100 px-4 py-2 rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 size={16} />
            Clear Logs
          </button>
          <button 
            onClick={fetchLogs}
            className="text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 px-4 py-2 rounded-md shadow-sm transition-colors"
          >
            Refresh Logs
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg flex items-start gap-3 border border-red-100">
          <ServerCrash size={20} className="shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {logs.length === 0 && !loading && !error ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 flex flex-col items-center justify-center text-center shadow-sm">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mb-4">
            <CheckCircle2 className="text-emerald-500" size={32} />
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-1">No Errors Found!</h3>
          <p className="text-slate-500 text-sm max-w-md">Your pipeline is running smoothly. There are no recent failed or aborted tasks.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="divide-y divide-slate-100">
            {logs.map((log) => (
              <div 
                key={log.job_id} 
                ref={(el) => taskRefs.current[log.job_id] = el}
                className={clsx(
                  "p-5 transition-colors",
                  targetTaskId === log.job_id ? "bg-indigo-50/80 border-l-4 border-indigo-500 shadow-inner" : "hover:bg-slate-50/50"
                )}
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-3">
                    {log.status === 'failed' ? (
                      <div className="p-2 bg-red-50 text-red-600 rounded-lg shrink-0">
                        <XCircle size={18} />
                      </div>
                    ) : (
                      <div className="p-2 bg-amber-50 text-amber-600 rounded-lg shrink-0">
                        <AlertTriangle size={18} />
                      </div>
                    )}
                    <div>
                      <h3 className="font-bold text-slate-800 text-base">{log.task_name}</h3>
                      <a href={log.source_url} target="_blank" rel="noopener noreferrer" className="text-sm text-slate-500 hover:text-blue-600 transition-colors truncate block max-w-lg mt-0.5">
                        {log.source_url}
                      </a>
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className={clsx(
                      "px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider",
                      log.status === 'failed' ? "bg-red-50 text-red-700 border border-red-100" : "bg-amber-50 text-amber-700 border border-amber-100"
                    )}>
                      {log.status}
                    </span>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
                      <Clock size={12} />
                      {new Date(log.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </div>
                    {log.status === 'failed' && (
                      <button
                        onClick={() => handleOpenReschedule(log)}
                        className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded-md text-xs font-semibold transition-colors"
                      >
                        <RefreshCcw size={12} />
                        Reschedule
                      </button>
                    )}
                  </div>
                </div>
                
                <div className={clsx(
                  "p-4 rounded-lg border text-sm font-mono overflow-x-auto",
                  log.status === 'failed' ? "bg-red-50/30 border-red-100 text-red-800" : "bg-amber-50/30 border-amber-100 text-amber-800"
                )}>
                  <div className="font-sans font-bold mb-1 text-xs opacity-70 uppercase tracking-wider">
                    {log.status === 'failed' ? 'Error Details' : 'Abort Reason'}
                  </div>
                  {log.error_message || "No error message provided."}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reschedule Modal */}
      {showRescheduleModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex flex-col items-center justify-center backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex flex-col items-center text-center">
              <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-4">
                <RefreshCcw size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-800">Reschedule Task</h3>
              <p className="text-sm text-slate-500 mt-2 truncate w-full max-w-sm">
                {rescheduleTask?.task_name}
              </p>
            </div>
            
            <div className="p-6">
              <div className="flex flex-col gap-4">
                <label className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                  <input 
                    type="radio" 
                    name="rescheduleType" 
                    value="now" 
                    checked={rescheduleType === 'now'} 
                    onChange={() => setRescheduleType('now')} 
                    className="w-4 h-4 text-primary focus:ring-primary"
                  />
                  <div className="flex flex-col">
                    <span className="font-semibold text-sm text-slate-800">Schedule Now</span>
                    <span className="text-xs text-slate-500">Send immediately to the scraping queue</span>
                  </div>
                </label>
                
                <label className="flex flex-col gap-3 p-3 border rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <input 
                      type="radio" 
                      name="rescheduleType" 
                      value="later" 
                      checked={rescheduleType === 'later'} 
                      onChange={() => setRescheduleType('later')} 
                      className="w-4 h-4 text-primary focus:ring-primary"
                    />
                    <div className="flex flex-col">
                      <span className="font-semibold text-sm text-slate-800">Schedule Later</span>
                      <span className="text-xs text-slate-500">Choose a future date to run this task</span>
                    </div>
                  </div>
                  
                  {rescheduleType === 'later' && (
                    <div className="pl-7 pr-2 pt-2">
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <Calendar size={16} className="text-slate-400" />
                        </div>
                        <input 
                          type="date" 
                          value={rescheduleDate}
                          onChange={e => setRescheduleDate(e.target.value)}
                          min={new Date().toISOString().split('T')[0]}
                          className="w-full pl-10 px-3 py-2 border border-slate-300 rounded-md focus:ring-primary focus:border-primary sm:text-sm text-slate-700"
                        />
                      </div>
                    </div>
                  )}
                </label>
              </div>
            </div>
            
            <div className="p-4 bg-slate-50 flex justify-end gap-3 border-t border-slate-100">
              <button 
                onClick={() => { setShowRescheduleModal(false); setRescheduleTask(null); }}
                disabled={rescheduleLoading}
                className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleRescheduleSubmit}
                disabled={rescheduleLoading || (rescheduleType === 'later' && !rescheduleDate)}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {rescheduleLoading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    Processing...
                  </>
                ) : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
