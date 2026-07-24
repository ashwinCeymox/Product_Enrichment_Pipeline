import React, { useState, useEffect } from 'react';
import api from '../api/client';
import { 
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useSearchParams } from 'react-router-dom';
import { Check, X, FileJson, Loader2, RefreshCw, ChevronLeft, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { TableSkeleton } from '../components/Shimmer';
import InsufficientCreditsModal from '../components/InsufficientCreditsModal';

export default function JsonReview() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState(null);
  const [jsonData, setJsonData] = useState('');
  const [activeTab, setActiveTab] = useState('table');
  const [saving, setSaving] = useState(false);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [creditError, setCreditError] = useState(null);
  const [creditWarning, setCreditWarning] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [rowSelection, setRowSelection] = useState({});
  const [isAborting, setIsAborting] = useState(false);
  const [searchParams] = useSearchParams();
  const targetTaskId = searchParams.get('taskId');

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const res = await api.get('/jobs/?status=waiting_for_approval');
      const fetchedJobs = res.data.jobs || [];
      setData(fetchedJobs);
      
      if (targetTaskId && !selectedJob) {
        const job = fetchedJobs.find(j => j.id === targetTaskId);
        if (job) {
          handleReview(job);
        } else {
          alert("This task is no longer available.");
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const handleReview = (job) => {
    setSelectedJob(job);
    setJsonData(JSON.stringify(job.product_data || {}, null, 2));
  };

  const handleApprove = async () => {
    if (!selectedJob) return;
    setSaving(true);
    setCreditWarning(null);
    try {
      let parsedData = {};
      try { parsedData = JSON.parse(jsonData); } catch(e) { alert('Invalid JSON format!'); setSaving(false); return; }
      
      const res = await api.post(`/jobs/${selectedJob.id}/approve`, { product_data: parsedData });
      
      if (res.data.warning) {
        setCreditWarning(res.data.warning_message || 'Credits are running low');
        setTimeout(() => setCreditWarning(null), 5000);
      }
      
      setSelectedJob(null);
      fetchJobs();
    } catch (err) {
      if (err.response?.status === 402 && err.response?.data?.detail?.error === 'insufficient_credits') {
        setCreditError(err.response.data.detail);
        setShowCreditModal(true);
      } else {
        console.error(err);
        alert('Failed to approve job');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (!selectedJob) return;
    setSaving(true);
    try {
      await api.post(`/jobs/${selectedJob.id}/reject`);
      setSelectedJob(null);
      fetchJobs();
    } catch (err) {
      console.error(err);
      alert('Failed to reject job');
    } finally {
      setSaving(false);
    }
  };

  const handleBulkRemove = async () => {
    const selectedIds = table.getSelectedRowModel().rows.map(r => r.original.id);
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to remove ${selectedIds.length} tasks? They will be aborted.`)) return;
    
    setIsAborting(true);
    try {
      await Promise.all(selectedIds.map(id => api.delete(`/jobs/${id}`)));
      setRowSelection({});
      fetchJobs();
    } catch (err) {
      console.error('Failed to remove some jobs', err);
      alert('Failed to remove some jobs.');
    } finally {
      setIsAborting(false);
    }
  };

  const columnHelper = createColumnHelper();
  const columns = [
    columnHelper.display({
      id: 'select',
      header: ({ table }) => (
        <input
          type="checkbox"
          checked={table.getIsAllRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={row.getToggleSelectedHandler()}
          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
        />
      ),
    }),
    columnHelper.display({
      id: 'index',
      header: 'No.',
      cell: (info) => <span className="text-slate-400 font-medium">{info.row.index + 1}</span>,
    }),
    columnHelper.accessor('task_name', { 
      header: 'Task Name',
      cell: info => {
        const isAborted = ['aborted', 'failed'].includes(info.row.original.status);
        return (
          <div className="flex items-center gap-2">
            <span className={clsx("font-medium", isAborted ? "text-slate-400 line-through" : "text-slate-700")}>
              {info.getValue()}
            </span>
            {isAborted && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold tracking-wider rounded bg-rose-100 text-rose-700 border border-rose-200 uppercase">
                ABORTED
              </span>
            )}
          </div>
        );
      }
    }),
    columnHelper.accessor(row => {
      let data = row.product_data || {};
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch (e) {
          data = {};
        }
      }
      
      const identity = data.product_identity || {};
      
      return identity.product_name || identity.title || identity.name || data.title || data.name || data.product_name || data['Product Name'] || 'Data not available';
    }, { 
      id: 'product_name',
      header: 'Product Name',
      cell: info => <div className="max-w-xs truncate font-medium text-slate-700" title={info.getValue()}>{info.getValue()}</div>
    }),
    columnHelper.accessor('url', { 
      header: 'Source URL',
      cell: info => <div className="max-w-[200px] truncate text-xs text-slate-500" title={info.getValue()}><a href={info.getValue()} target="_blank" rel="noopener noreferrer" className="hover:text-primary hover:underline">{info.getValue()}</a></div> 
    }),
    columnHelper.accessor('created_at', { 
      header: 'Date',
      cell: info => <span className="text-slate-500 whitespace-nowrap">{new Date(info.getValue()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
    }),
    columnHelper.display({
      id: 'actions',
      header: 'Actions',
      cell: (info) => (
        <button 
          onClick={() => handleReview(info.row.original)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-md text-sm font-medium hover:bg-indigo-100 transition-colors"
        >
          <FileJson size={16} /> Review JSON
        </button>
      )
    })
  ];

  const filteredData = React.useMemo(() => {
    if (!searchQuery.trim()) return data;
    const lowerQ = searchQuery.toLowerCase();
    return data.filter(job => 
      job.task_name?.toLowerCase().includes(lowerQ) ||
      job.url?.toLowerCase().includes(lowerQ) ||
      (job.product_data && JSON.stringify(job.product_data).toLowerCase().includes(lowerQ))
    );
  }, [data, searchQuery]);

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">JSON Approval Queue</h2>
          <p className="text-sm text-slate-500 mt-1">Review, edit, and approve extracted product attributes before image generation.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          <input 
            type="text" 
            placeholder="Search task or URL..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:w-64 px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {Object.keys(rowSelection).length > 0 && (
            <button 
              onClick={handleBulkRemove}
              disabled={isAborting}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 bg-rose-50 border border-rose-200 rounded-md shadow-sm text-sm font-medium text-rose-700 hover:bg-rose-100 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {isAborting ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
              Remove Selected
            </button>
          )}
          <button 
            onClick={fetchJobs} 
            className="inline-flex items-center justify-center gap-2 px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <RefreshCw size={16} className={clsx(loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm text-left">
            <thead className="bg-slate-50">
              {table.getHeaderGroups().map(headerGroup => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map(header => (
                    <th key={header.id} className="px-6 py-3 font-semibold text-slate-700">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {loading && data.length === 0 ? (
                <TableSkeleton columns={7} rows={4} />
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-500">
                    No items awaiting approval.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map(row => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id} className="px-6 py-4 whitespace-nowrap text-slate-600">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Editor Modal */}
      {selectedJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-6 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white md:rounded-xl shadow-2xl w-full max-w-6xl flex flex-col h-full md:h-auto md:max-h-[90vh] overflow-hidden">
            <div className="px-6 pt-4 border-b border-slate-200 bg-slate-50">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setSelectedJob(null)}
                    className="md:hidden text-slate-500 hover:text-slate-700 p-1 -ml-1 flex-shrink-0"
                    disabled={saving}
                  >
                    <ChevronLeft size={24} />
                  </button>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-slate-800">Review Extraction Data</h3>
                    <p className="text-sm text-slate-500 truncate">{selectedJob.task_name} — {selectedJob.url}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedJob(null)} 
                  className="hidden md:block text-slate-400 hover:text-slate-600 p-1 flex-shrink-0"
                  disabled={saving}
                >
                  <X size={20} />
                </button>
              </div>
              <div className="flex gap-4 border-b border-slate-200">
                <button
                  className={clsx("pb-2 px-1 text-sm font-medium border-b-2 transition-colors", activeTab === 'table' ? "border-primary text-primary" : "border-transparent text-slate-500 hover:text-slate-700")}
                  onClick={() => setActiveTab('table')}
                >
                  Table View
                </button>
                <button
                  className={clsx("pb-2 px-1 text-sm font-medium border-b-2 transition-colors", activeTab === 'json' ? "border-primary text-primary" : "border-transparent text-slate-500 hover:text-slate-700")}
                  onClick={() => setActiveTab('json')}
                >
                  Raw JSON
                </button>
              </div>
            </div>
            
            <div className="flex-1 p-6 overflow-y-auto bg-slate-100">
              {activeTab === 'json' ? (
                <textarea 
                  className="w-full min-h-[500px] h-[65vh] font-mono text-sm p-4 rounded-md border border-slate-300 focus:ring-primary focus:border-primary shadow-inner bg-white overflow-auto"
                  value={jsonData}
                  onChange={e => setJsonData(e.target.value)}
                  spellCheck={false}
                  wrap="off"
                />
              ) : (
                <div className="bg-white rounded-md border border-slate-300 shadow-inner min-h-[500px] h-[65vh] overflow-auto">
                  {(() => {
                    let parsed = {};
                    let isValid = true;
                    try {
                      parsed = JSON.parse(jsonData);
                      if (typeof parsed !== 'object' || parsed === null) throw new Error();
                    } catch (e) {
                      isValid = false;
                    }

                    if (!isValid) {
                      return (
                        <div className="flex items-center justify-center h-full text-red-500 text-sm">
                          Invalid JSON format. Please fix in the Raw JSON tab first.
                        </div>
                      );
                    }

                    const updateJsonPath = (path, value) => {
                      try {
                        const newParsed = JSON.parse(jsonData);
                        let current = newParsed;
                        for (let i = 0; i < path.length - 1; i++) {
                          current = current[path[i]];
                        }
                        current[path[path.length - 1]] = value;
                        setJsonData(JSON.stringify(newParsed, null, 2));
                      } catch (e) {
                        console.error(e);
                      }
                    };

                    const renderRecursiveEditor = (data, path = []) => {
                      if (data === null) {
                        return (
                          <input 
                            className="w-full text-sm border-slate-300 rounded-md shadow-sm focus:border-primary focus:ring-primary p-2 border bg-white focus:outline-none"
                            value=""
                            placeholder="null"
                            onChange={(e) => updateJsonPath(path, e.target.value)}
                          />
                        );
                      }

                      if (Array.isArray(data)) {
                        return (
                          <div className="flex flex-col gap-3 pl-4 border-l-2 border-indigo-200 mt-1 mb-2">
                            {data.map((item, idx) => (
                              <div key={idx} className="flex gap-3 items-start bg-slate-50/50 p-2 rounded border border-slate-100">
                                <span className="text-[10px] font-bold text-slate-400 mt-2 w-4 shrink-0">{idx + 1}.</span>
                                <div className="flex-1">
                                  {renderRecursiveEditor(item, [...path, idx])}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      }

                      if (typeof data === 'object') {
                        return (
                          <div className="flex flex-col gap-4 pl-4 border-l-2 border-slate-200 mt-2 mb-3 w-full">
                            {Object.entries(data).map(([key, val]) => (
                              <div key={key} className="flex flex-col gap-1.5">
                                <label className="text-xs font-bold text-slate-600 tracking-wide uppercase">{key.replace(/_/g, ' ')}</label>
                                {renderRecursiveEditor(val, [...path, key])}
                              </div>
                            ))}
                          </div>
                        );
                      }

                      // Primitive (string, number, boolean)
                      return (
                        <textarea 
                          value={data}
                          rows={String(data).length > 80 ? 3 : 1}
                          onChange={(e) => {
                            let val = e.target.value;
                            if (typeof data === 'number') val = Number(val) || 0;
                            if (typeof data === 'boolean') val = val === 'true';
                            updateJsonPath(path, val);
                          }}
                          className="w-full text-sm border-slate-300 rounded-md shadow-sm focus:border-primary focus:ring-primary p-2 border bg-white focus:outline-none transition-shadow"
                        />
                      );
                    };

                    if (Object.keys(parsed).length === 0) {
                      return (
                        <div className="flex items-center justify-center h-full text-red-500 text-sm">
                          Invalid JSON format. Please fix in the Raw JSON tab first.
                        </div>
                      );
                    }
                    
                    const keys = Object.keys(parsed);
                    if (keys.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center h-full text-slate-500 text-sm">
                          <p>The JSON object is empty.</p>
                          <button onClick={() => setActiveTab('json')} className="mt-2 text-primary hover:underline">Switch to Raw JSON to add data manually</button>
                        </div>
                      );
                    }

                    return (
                      <div className="p-6">
                        {Object.entries(parsed).map(([key, val]) => (
                          <div key={key} className="mb-6 bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                            <div className="bg-slate-50 border-b border-slate-200 px-4 py-2">
                              <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wide">{key.replace(/_/g, ' ')}</h4>
                            </div>
                            <div className="p-4">
                              {renderRecursiveEditor(val, [key])}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
            
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
              <button 
                onClick={handleReject}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 border border-red-300 text-red-700 bg-white rounded-md font-medium text-sm hover:bg-red-50 focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
              >
                <X size={16} /> Reject
              </button>
              <button 
                onClick={handleApprove}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md font-medium text-sm hover:bg-emerald-700 focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-50"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Approve & Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Credit Warning Toast */}
      {creditWarning && (
        <div className="fixed top-4 right-4 z-50 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 animate-in slide-in-from-top duration-300">
          <AlertTriangle size={18} className="text-amber-500" />
          <span className="text-sm font-medium">{creditWarning}</span>
          <button onClick={() => setCreditWarning(null)} className="text-amber-400 hover:text-amber-600">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Insufficient Credits Modal */}
      <InsufficientCreditsModal
        isOpen={showCreditModal}
        onClose={() => setShowCreditModal(false)}
        remainingCredits={creditError?.actual_remaining}
        jobCost={creditError?.job_cost}
        mode="approval"
      />

    </div>
  );
}
