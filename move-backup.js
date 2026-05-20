import fs from 'fs';

const chatFile = 'src/components/ChatArea.tsx';
const sidebarFile = 'src/components/Sidebar.tsx';

let chatCode = fs.readFileSync(chatFile, 'utf8');
let sidebarCode = fs.readFileSync(sidebarFile, 'utf8');

// 1. Remove BackupModal from Sidebar
const backupModalRegex = /const BackupModal = \(\{[\s\S]*?\}\);\n};\n/;
sidebarCode = sidebarCode.replace(backupModalRegex, '');
sidebarCode = sidebarCode.replace(`const [showBackupModal, setShowBackupModal] = useState(false);`, '');
sidebarCode = sidebarCode.replace(
`<button onClick={() => { setShowFeedbackModal(true); setShowDropdown(false); }} className="block w-full text-left px-4 py-3 text-sm text-[#d1d7db] hover:bg-[#202c33] transition-colors border-b border-[#202c33]">Submit Feedback</button>
                    <button onClick={() => { setShowBackupModal(true); setShowDropdown(false); }} className="block w-full text-left px-4 py-3 text-sm text-blue-400 hover:bg-[#202c33] transition-colors flex items-center gap-2 font-medium">
                       <Download className="w-4 h-4" /> Export / Import Chats
                    </button>`,
`<button onClick={() => { setShowFeedbackModal(true); setShowDropdown(false); }} className="block w-full text-left px-4 py-3 text-sm text-[#d1d7db] hover:bg-[#202c33] transition-colors border-b border-[#202c33]">Submit Feedback</button>`
);
sidebarCode = sidebarCode.replace(`{showBackupModal && <BackupModal onClose={() => setShowBackupModal(false)} currentUser={currentUser} />}`, '');

fs.writeFileSync(sidebarFile, sidebarCode);
console.log('Removed from Sidebar.tsx');

// 2. Add BackupModal to ChatArea
if (!chatCode.includes('import { importMessagesLocal }')) {
  chatCode = chatCode.replace(`import { saveMessageLocal, getMessagesLocal, deleteMessageLocal } from '../utils/db';`, `import { saveMessageLocal, getMessagesLocal, deleteMessageLocal, getAllMessagesLocal, importMessagesLocal } from '../utils/db';`);
}
if (!chatCode.includes('Download,')) {
  chatCode = chatCode.replace(`import { MessageSquare, Phone, Video, Send, File, Image, Shield, ArrowLeft, Clock, Mic, CheckCircle2, Play, Pause, Trash2, Maximize2, MoreVertical, Flag, UserX, ExternalLink } from 'lucide-react';`, `import { MessageSquare, Phone, Video, Send, File, Image, Shield, ArrowLeft, Clock, Mic, CheckCircle2, Play, Pause, Trash2, Maximize2, MoreVertical, Flag, UserX, ExternalLink, Download, Upload, X } from 'lucide-react';`);
}

const newBackupModal = `
const BackupModal = ({ onClose, sessionInfo }: { onClose: () => void, sessionInfo: any }) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleExport = async () => {
    if (!startDate || !endDate) return alert("Please select start and end dates.");
    setIsExporting(true);
    try {
       const msgs = await getAllMessagesLocal();
       const startTs = new Date(startDate).setHours(0,0,0,0);
       const endTs = new Date(endDate).setHours(23,59,59,999);
       const filteredMsgs = msgs.filter(m => m.timestamp >= startTs && m.timestamp <= endTs && m.sessionId === sessionInfo.sessionId);
       
       if (filteredMsgs.length === 0) {
          alert("No messages found in that date range for this chat.");
          setIsExporting(false);
          return;
       }
       
       const blob = new Blob([JSON.stringify(filteredMsgs)], { type: 'application/json' });
       const url = URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = url;
       a.download = \`stegochat_backup_\${startDate}_to_\${endDate}.stego\`;
       a.click();
       URL.revokeObjectURL(url);
       alert(\`Successfully exported \${filteredMsgs.length} messages.\`);
    } catch(e) {
       console.error(e);
       alert("Failed to export chats.");
    }
    setIsExporting(false);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const text = await file.text();
      const msgs = JSON.parse(text);
      if (!Array.isArray(msgs)) throw new Error("Invalid backup format");
      
      await importMessagesLocal(msgs);
      alert(\`Successfully imported \${msgs.length} messages!\`);
      window.location.reload(); 
    } catch (e: any) {
      console.error(e);
      alert("Failed to import chats: " + e.message);
    }
    setIsImporting(false);
  };

  return createPortal(
    <div className="fixed inset-0 bg-[#0b141a]/80 z-[9999] flex items-center justify-center p-4">
       <div className="bg-[#202c33] rounded-2xl w-full max-w-md p-6 border border-[#2a3942] shadow-2xl">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-white flex items-center"><Download className="w-5 h-5 mr-2 text-[#00a884]"/> Chat Backup</h2>
            <button onClick={onClose} className="text-[#8696a0] hover:text-white"><X className="w-6 h-6"/></button>
          </div>
          
          <div className="mb-6 space-y-4">
             <div className="bg-[#111b21] p-4 rounded-lg border border-[#2a3942]">
                <h3 className="text-[#e9edef] font-medium mb-2">Export Chats</h3>
                <p className="text-[#8696a0] text-sm mb-4">Download a secure .stego file containing your chat history within a specific date range.</p>
                <div className="flex gap-2 mb-4">
                   <div className="flex-1">
                      <label className="text-xs text-[#8696a0] mb-1 block">From</label>
                      <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full bg-[#202c33] text-white p-2 rounded outline-none border border-transparent focus:border-[#00a884]" />
                   </div>
                   <div className="flex-1">
                      <label className="text-xs text-[#8696a0] mb-1 block">To</label>
                      <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full bg-[#202c33] text-white p-2 rounded outline-none border border-transparent focus:border-[#00a884]" />
                   </div>
                </div>
                <button onClick={handleExport} disabled={isExporting} className="w-full py-2 bg-[#00a884] hover:bg-[#06cf9c] text-white font-bold rounded shadow-lg disabled:opacity-50 transition-colors">
                   {isExporting ? 'Exporting...' : 'Export to .stego'}
                </button>
             </div>
             
             <div className="bg-[#111b21] p-4 rounded-lg border border-[#2a3942]">
                <h3 className="text-[#e9edef] font-medium mb-2">Import Chats</h3>
                <p className="text-[#8696a0] text-sm mb-4">Restore your messages from a previous .stego backup file.</p>
                <label className="w-full py-2 bg-[#2a3942] hover:bg-[#3a4952] text-white font-bold rounded shadow-lg flex items-center justify-center cursor-pointer transition-colors">
                   {isImporting ? 'Importing...' : <><Upload className="w-4 h-4 mr-2" /> Import from .stego</>}
                   <input type="file" accept=".stego,.json" className="hidden" onChange={handleImport} disabled={isImporting} />
                </label>
             </div>
          </div>
       </div>
    </div>,
    document.body
  );
};
`;

if (!chatCode.includes('BackupModal')) {
  chatCode = chatCode.replace(`export function ChatArea`, `${newBackupModal}\nexport function ChatArea`);
}

if (!chatCode.includes('showBackupModal')) {
  chatCode = chatCode.replace(`const [showDropdown, setShowDropdown] = useState(false);`, `const [showDropdown, setShowDropdown] = useState(false);\n  const [showBackupModal, setShowBackupModal] = useState(false);`);
}

// Remove old timer select and button from header
chatCode = chatCode.replace(/\{\s*snapchatMode && \(\s*<select[\s\S]*?<\/select>\s*\)\s*\}/, '');
chatCode = chatCode.replace(/<button\s*onClick=\{\(\) => setSnapchatMode\(!snapchatMode\)\}[\s\S]*?<\/button>/, '');

// Update the dropdown menu
chatCode = chatCode.replace(
`<button onClick={() => { localStorage.setItem('duration_'+sessionInfo.sessionId, '24h'); alert('Chat set to 24 Hours. Older messages will auto-delete on refresh.'); setShowDropdown(false); }} className="w-full text-left px-4 py-3 text-white text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors">
                      <Clock className="w-4 h-4 text-[#00a884]" />
                      🕒 Keep for 24 Hours
                   </button>`,
`<button onClick={() => { localStorage.setItem('duration_'+sessionInfo.sessionId, '24h'); alert('Chat set to 24 Hours. Older messages will auto-delete on refresh.'); setShowDropdown(false); }} className="w-full text-left px-4 py-3 text-white text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors border-b border-[#202c33]">
                      <Clock className="w-4 h-4 text-[#00a884]" />
                      🕒 Keep for 24 Hours
                   </button>
                   <div className="px-4 py-3 hover:bg-[#202c33] transition-colors border-b border-[#202c33] flex items-center justify-between">
                     <div className="flex items-center gap-3">
                       <Clock className="w-4 h-4 text-orange-400" />
                       <span className="text-sm text-white font-medium">Instant</span>
                     </div>
                     <div className="flex items-center gap-2">
                       <select 
                         className="bg-[#111b21] text-xs font-bold text-orange-400 border border-[#3b4a54] rounded-md px-1 py-1 outline-none cursor-pointer"
                         value={timer}
                         onChange={(e) => setTimer(Number(e.target.value))}
                       >
                         <option value={5}>5s</option>
                         <option value={10}>10s</option>
                         <option value={30}>30s</option>
                         <option value={60}>1m</option>
                       </select>
                       <input 
                         type="checkbox" 
                         checked={snapchatMode}
                         onChange={() => setSnapchatMode(!snapchatMode)}
                         className="w-4 h-4 accent-orange-400"
                       />
                     </div>
                   </div>
                   <div className="px-4 py-2 text-xs text-[#8696a0] font-bold uppercase tracking-wider bg-[#111b21]">Data Management</div>
                   <button onClick={() => { setShowBackupModal(true); setShowDropdown(false); }} className="w-full text-left px-4 py-3 text-blue-400 text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors">
                      <Download className="w-4 h-4" />
                      Export / Import Chat
                   </button>`
);

if (!chatCode.includes('{showBackupModal && <BackupModal')) {
  chatCode = chatCode.replace(`{showReportModal && <ReportModal onClose={() => setShowReportModal(false)} />}`, `{showReportModal && <ReportModal onClose={() => setShowReportModal(false)} />}\n      {showBackupModal && <BackupModal onClose={() => setShowBackupModal(false)} sessionInfo={sessionInfo} />}`);
}

fs.writeFileSync(chatFile, chatCode);
console.log('Added to ChatArea.tsx');
