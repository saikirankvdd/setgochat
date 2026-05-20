import fs from 'fs';

const file = 'src/components/ChatArea.tsx';
let code = fs.readFileSync(file, 'utf8');

// 1. Fix addMessageLocal to NOT save Snapchat mode messages
code = code.replace(
  `const duration = localStorage.getItem('duration_' + sessionInfo.sessionId) || 'permanent';`,
  `if (msg.isSelfDestruct) return; // Never save disappearing messages
      const duration = localStorage.getItem('duration_' + sessionInfo.sessionId) || 'permanent';`
);

// 2. Build the DataManagementModal and restore it
const dataManagementModal = `
const DataManagementModal = ({ onClose, sessionInfo, targetUser }: { onClose: () => void, sessionInfo: any, targetUser: any }) => {
  const [exportType, setExportType] = useState<'full' | 'range'>('full');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleExport = async () => {
    if (exportType === 'range' && (!startDate || !endDate)) return alert("Please select start and end dates.");
    if (!window.confirm("Do you want to export this chat? This will download a secure .stego backup file.")) return;
    
    setIsExporting(true);
    try {
       const msgs = await getAllMessagesLocal();
       let filteredMsgs = msgs.filter(m => m.sessionId === sessionInfo.sessionId);
       
       if (exportType === 'range') {
         const startTs = new Date(startDate).setHours(0,0,0,0);
         const endTs = new Date(endDate).setHours(23,59,59,999);
         filteredMsgs = filteredMsgs.filter(m => m.timestamp >= startTs && m.timestamp <= endTs);
       }
       
       if (filteredMsgs.length === 0) {
          alert("No messages found to export in that range.");
          setIsExporting(false);
          return;
       }
       
       const blob = new Blob([JSON.stringify(filteredMsgs)], { type: 'application/json' });
       const url = URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = url;
       const dateStr = new Date().toISOString().split('T')[0];
       a.download = \`stegochat_backup_\${targetUser.username}_\${dateStr}.stego\`;
       a.click();
       URL.revokeObjectURL(url);
    } catch(e) {
       console.error(e);
       alert("Failed to export chats.");
    }
    setIsExporting(false);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!window.confirm("Do you want to import this chat backup? Messages will be securely merged into this chat.")) return;
    setIsImporting(true);
    try {
      const text = await file.text();
      const msgs = JSON.parse(text);
      if (!Array.isArray(msgs)) throw new Error("Invalid backup format");
      
      await importMessagesLocal(msgs);
      alert(\`Successfully imported \${msgs.length} messages! Reloading...\`);
      window.location.reload(); 
    } catch (err: any) {
      console.error(err);
      alert("Failed to import chats: " + err.message);
    }
    setIsImporting(false);
  };

  return createPortal(
    <div className="fixed inset-0 bg-[#0b141a]/80 z-[9999] flex items-center justify-center p-4">
       <div className="bg-[#202c33] rounded-2xl w-full max-w-3xl p-6 border border-[#2a3942] shadow-2xl">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-white flex items-center"><Download className="w-5 h-5 mr-2 text-[#00a884]"/> Data Management</h2>
            <button onClick={onClose} className="text-[#8696a0] hover:text-white"><X className="w-6 h-6"/></button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             {/* EXPORT COLUMN */}
             <div className="bg-[#111b21] p-5 rounded-xl border border-[#2a3942] flex flex-col">
                <h3 className="text-[#e9edef] font-bold mb-2 flex items-center"><Download className="w-4 h-4 mr-2 text-blue-400"/> Export Chat</h3>
                <p className="text-[#8696a0] text-sm mb-4 flex-1">Generate a secure .stego backup file of this chat.</p>
                
                <div className="space-y-3 mb-6">
                  <label className="flex items-center space-x-3 text-sm text-white cursor-pointer">
                    <input type="radio" name="exportType" value="full" checked={exportType === 'full'} onChange={() => setExportType('full')} className="accent-[#00a884]" />
                    <span>Full Chat</span>
                  </label>
                  <label className="flex items-center space-x-3 text-sm text-white cursor-pointer">
                    <input type="radio" name="exportType" value="range" checked={exportType === 'range'} onChange={() => setExportType('range')} className="accent-[#00a884]" />
                    <span>Specific Date Range</span>
                  </label>
                </div>
                
                {exportType === 'range' && (
                  <div className="flex gap-2 mb-6">
                     <div className="flex-1">
                        <label className="text-xs text-[#8696a0] mb-1 block">From</label>
                        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full bg-[#202c33] text-white p-2 text-sm rounded outline-none border border-[#3b4a54] focus:border-[#00a884]" />
                     </div>
                     <div className="flex-1">
                        <label className="text-xs text-[#8696a0] mb-1 block">To</label>
                        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full bg-[#202c33] text-white p-2 text-sm rounded outline-none border border-[#3b4a54] focus:border-[#00a884]" />
                     </div>
                  </div>
                )}
                
                <button onClick={handleExport} disabled={isExporting} className="w-full py-3 bg-[#00a884] hover:bg-[#06cf9c] text-[#111b21] font-bold rounded-lg shadow-lg disabled:opacity-50 transition-colors mt-auto">
                   {isExporting ? 'Exporting...' : 'Export File'}
                </button>
             </div>
             
             {/* IMPORT COLUMN */}
             <div className="bg-[#111b21] p-5 rounded-xl border border-[#2a3942] flex flex-col">
                <h3 className="text-[#e9edef] font-bold mb-2 flex items-center"><Upload className="w-4 h-4 mr-2 text-green-400"/> Import Chat</h3>
                <p className="text-[#8696a0] text-sm mb-6 flex-1">Restore messages from a previous .stego backup file into this session.</p>
                
                <label className="w-full py-3 bg-[#2a3942] hover:bg-[#3a4952] text-white font-bold rounded-lg shadow-lg flex items-center justify-center cursor-pointer transition-colors mt-auto border border-[#3b4a54]">
                   {isImporting ? 'Importing...' : <><Upload className="w-4 h-4 mr-2" /> Select File & Import</>}
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

if (!code.includes('DataManagementModal')) {
  code = code.replace(`export function ChatArea`, `${dataManagementModal}\nexport function ChatArea`);
}

// Ensure state for DataManagementModal
if (!code.includes('showDataModal')) {
  code = code.replace(
    `const [showDropdown, setShowDropdown] = useState(false);`,
    `const [showDropdown, setShowDropdown] = useState(false);
  const [showDataModal, setShowDataModal] = useState(false);`
  );
}

// Remove old handleExport / handleImport from ChatArea (if they are there)
code = code.replace(/const handleExport = async \(\) => \{[\s\S]*?Failed to export chats\."\);\n    \}\n  \};\n/g, '');
code = code.replace(/const handleImport = async \(e: React\.ChangeEvent<HTMLInputElement>\) => \{[\s\S]*?Failed to import chats: " \+ err\.message\);\n    \}\n  \};\n/g, '');

// Update the dropdown menu inside ChatArea to trigger the DataManagementModal
code = code.replace(
  `<button onClick={() => { handleExport(); setShowDropdown(false); }} className="w-full text-left px-4 py-3 text-blue-400 text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors border-b border-[#202c33]">
                      <Download className="w-4 h-4" />
                      Export Chat
                   </button>
                   <label className="w-full text-left px-4 py-3 text-green-400 text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors cursor-pointer">
                      <Upload className="w-4 h-4" />
                      Import Chat
                      <input type="file" accept=".stego,.json" className="hidden" onChange={(e) => { handleImport(e); setShowDropdown(false); }} />
                   </label>`,
  `<button onClick={() => { setShowDataModal(true); setShowDropdown(false); }} className="w-full text-left px-4 py-3 text-blue-400 text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors">
                      <Download className="w-4 h-4" />
                      Export / Import Chat
                   </button>`
);

// Render the DataManagementModal
if (!code.includes('showDataModal && <DataManagementModal')) {
  code = code.replace(
    `{showReportModal && <ReportModal onClose={() => setShowReportModal(false)} />}`,
    `{showReportModal && <ReportModal onClose={() => setShowReportModal(false)} />}\n      {showDataModal && <DataManagementModal onClose={() => setShowDataModal(false)} sessionInfo={sessionInfo} targetUser={targetUser} />}`
  );
}

// 3. Add Date Dividers to the Chat rendering
// Look for messages.map
code = code.replace(
  `messages.map(msg => (
              <div key={msg.id} className={\`flex \${msg.fromId === user.id ? 'justify-end' : 'justify-start'} animate-fade-in\`}>`,
  `messages.map((msg, index) => {
             const prevMsg = index > 0 ? messages[index - 1] : null;
             const msgDate = new Date(msg.timestamp).toLocaleDateString();
             const prevDate = prevMsg ? new Date(prevMsg.timestamp).toLocaleDateString() : null;
             const showDivider = msgDate !== prevDate;
             
             return (
              <React.Fragment key={msg.id}>
                {showDivider && (
                   <div className="flex justify-center my-4">
                      <div className="bg-[#111b21]/80 text-[#8696a0] text-xs px-3 py-1 rounded-lg backdrop-blur-sm shadow-sm uppercase tracking-wide">
                         {msgDate === new Date().toLocaleDateString() ? 'Today' : msgDate}
                      </div>
                   </div>
                )}
                <div className={\`flex \${msg.fromId === user.id ? 'justify-end' : 'justify-start'} animate-fade-in\`}>`
);
code = code.replace(
  `</div>
            ))}
            <div ref={messagesEndRef} />`,
  `</div>
              </React.Fragment>
            )})}
            <div ref={messagesEndRef} />`
);

fs.writeFileSync(file, code);
console.log('Successfully patched UI.');
