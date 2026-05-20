import fs from 'fs';

const file = 'src/components/ChatArea.tsx';
let code = fs.readFileSync(file, 'utf8');

// 1. Define states inside ChatArea
if (!code.includes('const [dropdownView')) {
  code = code.replace(
    `const [showDropdown, setShowDropdown] = useState(false);`,
    `const [showDropdown, setShowDropdown] = useState(false);\n  const [dropdownView, setDropdownView] = useState<'main' | 'export'>('main');\n  const [exportType, setExportType] = useState<'full' | 'range'>('full');\n  const [startDate, setStartDate] = useState('');\n  const [endDate, setEndDate] = useState('');\n  const [isExporting, setIsExporting] = useState(false);\n  const [isImporting, setIsImporting] = useState(false);`
  );
}

// 2. Extract handleExport and handleImport directly into ChatArea
// Note: they are currently inside DataManagementModal which is above ChatArea.
// I will just redefine them inside ChatArea safely.

const exportFunctions = `
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
`;

if (!code.includes('const handleExport = async () => {')) {
  code = code.replace(/const endCall = \(\) => \{[\s\S]*?\n  \};\n/, `$&${exportFunctions}`);
}

// 3. Update the dropdown rendering
const oldDropdownContent = `                   <button onClick={() => { setShowReportModal(true); setShowDropdown(false); }} className="block w-full text-left px-4 py-3 text-sm text-yellow-500 hover:bg-[#202c33] transition-colors font-medium flex items-center">
                      <Flag className="w-4 h-4 mr-2" /> Report User
                   </button>
                   <button onClick={() => { handleBlockUser(); setShowDropdown(false); }} disabled={isBlocking} className="block w-full text-left px-4 py-3 text-sm text-red-500 hover:bg-[#202c33] transition-colors font-medium flex items-center border-b border-[#202c33]">
                      <UserX className="w-4 h-4 mr-2" /> Block User
                   </button>
                   <div className="px-4 py-2 text-xs text-[#8696a0] font-bold uppercase tracking-wider bg-[#111b21]">Chat Duration</div>
                   <button onClick={() => { localStorage.setItem('duration_'+sessionInfo.sessionId, 'permanent'); alert('Chat set to Permanent Storage'); setShowDropdown(false); }} className="w-full text-left px-4 py-3 text-white text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors">
                      <ExternalLink className="w-4 h-4 text-[#00a884]" />
                      💾 Keep Permanent
                   </button>
                   <button onClick={() => { localStorage.setItem('duration_'+sessionInfo.sessionId, '24h'); alert('Chat set to 24 Hours. Older messages will auto-delete on refresh.'); setShowDropdown(false); }} className="w-full text-left px-4 py-3 text-white text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors border-b border-[#202c33]">
                      <Clock className="w-4 h-4 text-[#00a884]" />
                      🕒 Keep for 24 Hours
                   </button>
                   <div className="px-4 py-3 hover:bg-[#202c33] transition-colors flex items-center justify-between">
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
                   <button onClick={() => { setShowDataModal(true); setShowDropdown(false); }} className="w-full text-left px-4 py-3 text-blue-400 text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors">
                      <Download className="w-4 h-4" />
                      Export / Import Chat
                   </button>`;

const newDropdownContent = `                   {dropdownView === 'main' ? (
                     <>
                       <button onClick={() => { setShowReportModal(true); setShowDropdown(false); }} className="block w-full text-left px-4 py-3 text-sm text-yellow-500 hover:bg-[#202c33] transition-colors font-medium flex items-center">
                          <Flag className="w-4 h-4 mr-2" /> Report User
                       </button>
                       <button onClick={() => { handleBlockUser(); setShowDropdown(false); }} disabled={isBlocking} className="block w-full text-left px-4 py-3 text-sm text-red-500 hover:bg-[#202c33] transition-colors font-medium flex items-center border-b border-[#202c33]">
                          <UserX className="w-4 h-4 mr-2" /> Block User
                       </button>
                       <div className="px-4 py-2 text-xs text-[#8696a0] font-bold uppercase tracking-wider bg-[#111b21]">Chat Duration</div>
                       <button onClick={() => { localStorage.setItem('duration_'+sessionInfo.sessionId, 'permanent'); alert('Chat set to Permanent Storage'); setShowDropdown(false); }} className="w-full text-left px-4 py-3 text-white text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors">
                          <ExternalLink className="w-4 h-4 text-[#00a884]" />
                          💾 Keep Permanent
                       </button>
                       <button onClick={() => { localStorage.setItem('duration_'+sessionInfo.sessionId, '24h'); alert('Chat set to 24 Hours. Older messages will auto-delete on refresh.'); setShowDropdown(false); }} className="w-full text-left px-4 py-3 text-white text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors border-b border-[#202c33]">
                          <Clock className="w-4 h-4 text-[#00a884]" />
                          🕒 Keep for 24 Hours
                       </button>
                       <div className="px-4 py-3 hover:bg-[#202c33] transition-colors flex items-center justify-between">
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
                       <button onClick={() => setDropdownView('export')} className="w-full text-left px-4 py-3 text-blue-400 text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors border-b border-[#202c33]">
                          <Download className="w-4 h-4" />
                          Export Chat
                       </button>
                       <label className="w-full text-left px-4 py-3 text-green-400 text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors cursor-pointer">
                          <Upload className="w-4 h-4" />
                          Import Chat
                          <input type="file" accept=".stego,.json" className="hidden" onChange={(e) => { handleImport(e); setShowDropdown(false); setDropdownView('main'); }} />
                       </label>
                     </>
                   ) : dropdownView === 'export' ? (
                     <div className="flex flex-col">
                        <button onClick={() => setDropdownView('main')} className="px-4 py-3 text-[#8696a0] hover:text-white hover:bg-[#202c33] flex items-center text-sm font-bold border-b border-[#202c33] transition-colors"><ArrowLeft className="w-4 h-4 mr-2"/> Back</button>
                        <div className="p-4">
                          <h3 className="text-white font-bold mb-3 flex items-center text-sm"><Download className="w-4 h-4 mr-2 text-blue-400"/> Export Chat</h3>
                          <div className="space-y-2 mb-4">
                            <label className="flex items-center space-x-2 text-sm text-white cursor-pointer"><input type="radio" checked={exportType === 'full'} onChange={() => setExportType('full')} className="accent-[#00a884]" /> <span>Full Chat</span></label>
                            <label className="flex items-center space-x-2 text-sm text-white cursor-pointer"><input type="radio" checked={exportType === 'range'} onChange={() => setExportType('range')} className="accent-[#00a884]" /> <span>Date Range</span></label>
                          </div>
                          {exportType === 'range' && (
                            <div className="flex gap-2 mb-4">
                              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="flex-1 bg-[#111b21] text-white p-1.5 text-xs rounded border border-[#3b4a54] outline-none" />
                              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="flex-1 bg-[#111b21] text-white p-1.5 text-xs rounded border border-[#3b4a54] outline-none" />
                            </div>
                          )}
                          <button onClick={() => { handleExport(); setShowDropdown(false); setDropdownView('main'); }} disabled={isExporting} className="w-full py-2 bg-[#00a884] hover:bg-[#06cf9c] text-[#111b21] text-sm font-bold rounded shadow transition-colors">{isExporting ? 'Exporting...' : 'Export File'}</button>
                        </div>
                     </div>
                   ) : null}`;

code = code.replace(oldDropdownContent, newDropdownContent);

// 4. Remove DataManagementModal component completely since we don't need it.
code = code.replace(/const DataManagementModal = \(\{ onClose, sessionInfo, targetUser \}: \{ onClose: \(\) => void, sessionInfo: any, targetUser: any \}\) => \{[\s\S]*?\n\};\n/, '\n');

// 5. Update the "MoreVertical" onClick to reset the dropdownView to main when opened
code = code.replace(
  `<MoreVertical className="w-5 h-5 cursor-pointer hover:text-[#d1d7db]" onClick={() => setShowDropdown(!showDropdown)} />`,
  `<MoreVertical className="w-5 h-5 cursor-pointer hover:text-[#d1d7db]" onClick={() => { setShowDropdown(!showDropdown); setDropdownView('main'); }} />`
);

fs.writeFileSync(file, code);
console.log('Successfully updated Dropdown UI.');
