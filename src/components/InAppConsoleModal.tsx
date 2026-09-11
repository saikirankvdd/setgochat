import React, { useState, useEffect, useRef } from 'react';
import { Terminal, X, Copy, Trash2, Check, Filter, Search, ChevronDown, ArrowDown } from 'lucide-react';

export interface LogEntry {
  id: number;
  time: string;
  type: 'log' | 'warn' | 'error' | 'info';
  message: string;
}

// Global console log interceptor state
if (typeof window !== 'undefined' && !(window as any).__consoleInterceptorsInstalled) {
  (window as any).__consoleInterceptorsInstalled = true;
  (window as any).__appConsoleLogs = (window as any).__appConsoleLogs || [];
  const logsList: LogEntry[] = (window as any).__appConsoleLogs;
  let nextId = 1;

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalInfo = console.info;

  const formatArg = (arg: any): string => {
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, (key, val) => {
          if (val instanceof ArrayBuffer || ArrayBuffer.isView(val)) {
            return `[Buffer len=${(val as any).byteLength || (val as any).length}]`;
          }
          return val;
        }, 2);
      } catch (_) {
        return String(arg);
      }
    }
    return String(arg);
  };

  const addLog = (type: 'log' | 'warn' | 'error' | 'info', args: any[]) => {
    const time = new Date().toLocaleTimeString();
    const message = args.map(formatArg).join(' ');
    const entry: LogEntry = { id: nextId++, time, type, message };
    logsList.push(entry);
    if (logsList.length > 800) logsList.shift();
    
    // Notify active listeners
    if ((window as any).__onNewConsoleLog) {
      try { (window as any).__onNewConsoleLog(entry); } catch (_) {}
    }
  };

  console.log = (...args) => { originalLog.apply(console, args); addLog('log', args); };
  console.warn = (...args) => { originalWarn.apply(console, args); addLog('warn', args); };
  console.error = (...args) => { originalError.apply(console, args); addLog('error', args); };
  console.info = (...args) => { originalInfo.apply(console, args); addLog('info', args); };
}

interface InAppConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InAppConsoleModal: React.FC<InAppConsoleModalProps> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'error' | 'warn' | 'stego'>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Sync logs when modal opens and listen for live updates
  useEffect(() => {
    if (!isOpen) return;
    
    // Load initial logs
    const existingLogs: LogEntry[] = (window as any).__appConsoleLogs || [];
    setLogs([...existingLogs]);

    // Live update callback
    (window as any).__onNewConsoleLog = (newEntry: LogEntry) => {
      setLogs(prev => [...prev.slice(-799), newEntry]);
    };

    return () => {
      delete (window as any).__onNewConsoleLog;
    };
  }, [isOpen]);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (isOpen && autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, isOpen, autoScroll]);

  if (!isOpen) return null;

  const handleCopy = () => {
    const text = filteredLogs.map(l => `[${l.time}] [${l.type.toUpperCase()}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      alert("Failed to copy logs to clipboard.");
    });
  };

  const handleClear = () => {
    (window as any).__appConsoleLogs = [];
    setLogs([]);
  };

  const filteredLogs = logs.filter(entry => {
    if (filterType === 'error' && entry.type !== 'error') return false;
    if (filterType === 'warn' && entry.type !== 'warn') return false;
    if (filterType === 'stego' && !entry.message.toLowerCase().includes('stealth') && !entry.message.toLowerCase().includes('stego') && !entry.message.toLowerCase().includes('p2p') && !entry.message.toLowerCase().includes('rtp')) return false;
    
    if (searchTerm) {
      return entry.message.toLowerCase().includes(searchTerm.toLowerCase()) || entry.time.includes(searchTerm);
    }
    return true;
  });

  const errorCount = logs.filter(l => l.type === 'error').length;
  const warnCount = logs.filter(l => l.type === 'warn').length;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-[#111b21] border border-[#2a3942] rounded-xl w-full max-w-4xl h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="bg-[#202c33] px-4 py-3 border-b border-[#2a3942] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-[#00a884]" />
            <h3 className="text-[#e9edef] font-semibold text-base flex items-center gap-2">
              In-App Console Logs
              <span className="text-xs bg-[#2a3942] text-[#8696a0] px-2 py-0.5 rounded-full font-normal">
                {logs.length} entries
              </span>
            </h3>
            {errorCount > 0 && (
              <span className="text-xs bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full font-medium">
                {errorCount} {errorCount === 1 ? 'Error' : 'Errors'}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00a884] hover:bg-[#029675] text-[#111b21] font-semibold text-xs rounded-lg transition-colors shadow-sm"
              title="Copy all visible logs to clipboard"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy Logs'}
            </button>

            <button
              onClick={handleClear}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-[#2a3942] hover:bg-[#3b4a54] text-[#d1d7db] text-xs rounded-lg transition-colors"
              title="Clear all logs"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
              <span className="hidden sm:inline">Clear</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-[#8696a0] hover:text-[#e9edef] hover:bg-[#2a3942] rounded-lg transition-colors ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="bg-[#182229] px-4 py-2 border-b border-[#2a3942] flex flex-wrap items-center justify-between gap-2 text-xs flex-shrink-0">
          <div className="flex items-center gap-1 bg-[#111b21] border border-[#2a3942] rounded-lg p-0.5">
            <button
              onClick={() => setFilterType('all')}
              className={`px-2.5 py-1 rounded-md transition-colors font-medium ${filterType === 'all' ? 'bg-[#00a884] text-[#111b21]' : 'text-[#8696a0] hover:text-[#e9edef]'}`}
            >
              All ({logs.length})
            </button>
            <button
              onClick={() => setFilterType('stego')}
              className={`px-2.5 py-1 rounded-md transition-colors font-medium ${filterType === 'stego' ? 'bg-[#00a884] text-[#111b21]' : 'text-[#8696a0] hover:text-[#e9edef]'}`}
            >
              Stego / Call
            </button>
            <button
              onClick={() => setFilterType('error')}
              className={`px-2.5 py-1 rounded-md transition-colors font-medium ${filterType === 'error' ? 'bg-red-500 text-white' : 'text-[#8696a0] hover:text-red-400'}`}
            >
              Errors ({errorCount})
            </button>
            <button
              onClick={() => setFilterType('warn')}
              className={`px-2.5 py-1 rounded-md transition-colors font-medium ${filterType === 'warn' ? 'bg-yellow-500 text-black' : 'text-[#8696a0] hover:text-yellow-400'}`}
            >
              Warnings ({warnCount})
            </button>
          </div>

          <div className="flex items-center gap-2 flex-1 max-w-xs">
            <div className="relative w-full">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-[#8696a0]" />
              <input
                type="text"
                placeholder="Search logs..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-[#111b21] border border-[#2a3942] rounded-lg pl-8 pr-3 py-1 text-xs text-[#e9edef] placeholder-[#8696a0] focus:outline-none focus:border-[#00a884]"
              />
            </div>

            <label className="flex items-center gap-1 text-[#8696a0] hover:text-[#e9edef] cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={e => setAutoScroll(e.target.checked)}
                className="accent-[#00a884] rounded"
              />
              <span>Auto-scroll</span>
            </label>
          </div>
        </div>

        {/* Log Window */}
        <div
          ref={logContainerRef}
          className="flex-1 bg-[#0b141a] p-3 overflow-y-auto font-mono text-xs space-y-1.5 select-text"
        >
          {filteredLogs.length === 0 ? (
            <div className="text-center text-[#8696a0] py-12">
              No console logs recorded yet matching your filter.
            </div>
          ) : (
            filteredLogs.map(entry => {
              let textStyle = "text-[#d1d7db]";
              let prefixStyle = "text-[#8696a0]";
              
              if (entry.type === 'error') {
                textStyle = "text-red-400 bg-red-950/20 p-1 rounded border-l-2 border-red-500";
                prefixStyle = "text-red-300 font-bold";
              } else if (entry.type === 'warn') {
                textStyle = "text-yellow-300 bg-yellow-950/20 p-1 rounded border-l-2 border-yellow-500";
                prefixStyle = "text-yellow-400 font-bold";
              } else if (entry.message.includes('[Stealth') || entry.message.includes('[Stego')) {
                textStyle = "text-[#00a884]";
                prefixStyle = "text-[#00a884] font-bold";
              }

              return (
                <div key={entry.id} className={`leading-relaxed break-all ${textStyle}`}>
                  <span className={`${prefixStyle} mr-2 select-none`}>[{entry.time}]</span>
                  <span className="whitespace-pre-wrap">{entry.message}</span>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="bg-[#202c33] px-4 py-2 border-t border-[#2a3942] flex items-center justify-between text-[11px] text-[#8696a0] flex-shrink-0">
          <span>Tap <b>Copy Logs</b> to copy full debug output for troubleshooting.</span>
          <span>Showing {filteredLogs.length} / {logs.length}</span>
        </div>

      </div>
    </div>
  );
};
