const fs = require('fs');
const path = require('path');

const p = path.join(__dirname, 'src', 'components', 'ChatArea.tsx');
let content = fs.readFileSync(p, 'utf-8');

const newModal = `const DataManagementModal = ({ onClose, sessionInfo, targetUser }: { onClose: () => void, sessionInfo: any, targetUser: any }) => {
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [exportOption, setExportOption] = useState<'full_media' | 'full_text' | 'range_media' | 'range_text'>('full_media');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [password, setPassword] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewMsgs, setPreviewMsgs] = useState<any[]>([]);

  useEffect(() => {
    const fetchPreview = async () => {
      const msgs = await getAllMessagesLocal();
      let filteredMsgs = msgs.filter(m => m.sessionId === sessionInfo.sessionId);
      
      if (exportOption === 'range_media' || exportOption === 'range_text') {
        if (startDate && endDate) {
          const startTs = new Date(startDate).setHours(0,0,0,0);
          const endTs = new Date(endDate).setHours(23,59,59,999);
          filteredMsgs = filteredMsgs.filter(m => m.timestamp >= startTs && m.timestamp <= endTs);
        } else {
          filteredMsgs = [];
        }
      }

      if (exportOption === 'full_text' || exportOption === 'range_text') {
        filteredMsgs = filteredMsgs.map(m => {
          const { file, encryptedFile, ...rest } = m as any;
          return rest as any;
        });
      }
      setPreviewMsgs(filteredMsgs.slice(-5)); // show last 5 msgs as preview
    };
    fetchPreview();
  }, [exportOption, startDate, endDate, sessionInfo.sessionId]);

  const handleExport = async () => {
    if ((exportOption === 'range_media' || exportOption === 'range_text') && (!startDate || !endDate)) {
      return alert("Please select start and end dates.");
    }
    if (!password) {
      return alert("Please enter an export password to encrypt the backup.");
    }
    if (!window.confirm("Do you want to export this chat? This will generate a secure .stego (audio) file.")) return;
    
    setIsProcessing(true);
    try {
       const msgs = await getAllMessagesLocal();
       let filteredMsgs = msgs.filter(m => m.sessionId === sessionInfo.sessionId);
       
       if (exportOption === 'range_media' || exportOption === 'range_text') {
         const startTs = new Date(startDate).setHours(0,0,0,0);
         const endTs = new Date(endDate).setHours(23,59,59,999);
         filteredMsgs = filteredMsgs.filter(m => m.timestamp >= startTs && m.timestamp <= endTs);
       }

       if (exportOption === 'full_text' || exportOption === 'range_text') {
         filteredMsgs = filteredMsgs.map(m => {
           const { file, encryptedFile, ...rest } = m as any;
           return rest as any;
         });
       }
       
       if (filteredMsgs.length === 0) {
          alert("No messages found to export.");
          setIsProcessing(false);
          return;
       }
       
       const { strToU8, gzipSync } = await import('fflate');
       const { encryptData } = await import('../utils/crypto');
       
       const jsonString = JSON.stringify(filteredMsgs);
       const compressed = gzipSync(strToU8(jsonString), { level: 9 });
       
       // Convert Uint8Array to base64
       let binary = '';
       for (let i = 0; i < compressed.byteLength; i++) {
         binary += String.fromCharCode(compressed[i]);
       }
       const base64Data = window.btoa(binary);
       
       // Encrypt
       const encryptedData = encryptData(base64Data, password);
       
       // Hide in Audio
       const carrierBuffer = createDynamicCarrier4Bit(encryptedData.length);
       const finalBuffer = encodeLSB4Bit(carrierBuffer, encryptedData);
       
       const blob = new Blob([finalBuffer], { type: 'audio/wav' });
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
    setIsProcessing(false);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!password) {
      alert("Please enter the import password first.");
      e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!window.confirm("Do you want to import this chat backup? Messages will be securely merged.")) {
       e.target.value = '';
       return;
    }
    setIsProcessing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      
      const { decryptData } = await import('../utils/crypto');
      const { strFromU8, gunzipSync } = await import('fflate');
      
      const encryptedData = decodeLSB4Bit(arrayBuffer);
      const base64Data = decryptData(encryptedData, password);
      
      if (!base64Data) {
         throw new Error("Invalid password or corrupted stego file.");
      }
      
      const binaryStr = window.atob(base64Data);
      const uint8 = new Uint8Array(binaryStr.length);
      for(let i = 0; i < binaryStr.length; i++) {
         uint8[i] = binaryStr.charCodeAt(i);
      }
      
      const decompressed = gunzipSync(uint8);
      const jsonString = strFromU8(decompressed);
      const msgs = JSON.parse(jsonString);
      
      if (!Array.isArray(msgs)) throw new Error("Invalid backup format");
      
      await importMessagesLocal(msgs);
      alert(\`Successfully imported \${msgs.length} messages! Reloading...\`);
      window.location.reload(); 
    } catch (err: any) {
      console.error(err);
      alert("Failed to import chats: " + err.message);
    }
    setIsProcessing(false);
    e.target.value = '';
  };

  return createPortal(
    <div className="fixed inset-0 bg-[#0b141a]/80 z-[9999] flex items-center justify-center p-4 backdrop-blur-sm">
       <div className="bg-[#202c33] rounded-xl w-full max-w-4xl h-[600px] border border-[#2a3942] shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex justify-between items-center p-4 border-b border-[#2a3942]">
            <h2 className="text-xl font-bold text-white flex items-center"><Download className="w-5 h-5 mr-2 text-[#00a884]"/> Data Management</h2>
            <button onClick={onClose} className="text-[#8696a0] hover:text-white"><X className="w-6 h-6"/></button>
          </div>
          
          <div className="flex flex-1 overflow-hidden">
             {/* Left Box (Tabs) */}
             <div className="w-1/4 bg-[#111b21] border-r border-[#2a3942] flex flex-col p-4 space-y-2">
                <button 
                  onClick={() => setActiveTab('export')}
                  className={\`w-full text-left px-4 py-3 rounded-lg font-medium transition-colors \${activeTab === 'export' ? 'bg-[#2a3942] text-[#00a884]' : 'text-[#e9edef] hover:bg-[#202c33]'}\`}
                >
                  Export
                </button>
                <button 
                  onClick={() => setActiveTab('import')}
                  className={\`w-full text-left px-4 py-3 rounded-lg font-medium transition-colors \${activeTab === 'import' ? 'bg-[#2a3942] text-[#00a884]' : 'text-[#e9edef] hover:bg-[#202c33]'}\`}
                >
                  Import
                </button>
             </div>
             
             {/* Middle/Right Area */}
             <div className="flex-1 p-6 flex flex-col overflow-y-auto bg-[#0b141a]">
                {activeTab === 'export' ? (
                   <div className="flex flex-col md:flex-row gap-6 h-full">
                      {/* Options Box */}
                      <div className="flex-1 flex flex-col space-y-6">
                         <div className="bg-[#202c33] p-5 rounded-xl border border-[#2a3942] space-y-4">
                           <h3 className="text-white font-medium mb-2 border-b border-[#2a3942] pb-2">Export Options</h3>
                           <label className="flex items-center space-x-3 text-sm text-[#e9edef] cursor-pointer hover:bg-[#2a3942] p-2 rounded-md transition-colors">
                             <input type="radio" value="full_media" checked={exportOption === 'full_media'} onChange={() => setExportOption('full_media')} className="accent-[#00a884] w-4 h-4" />
                             <span>Full Chat Export</span>
                           </label>
                           <label className="flex items-center space-x-3 text-sm text-[#e9edef] cursor-pointer hover:bg-[#2a3942] p-2 rounded-md transition-colors">
                             <input type="radio" value="full_text" checked={exportOption === 'full_text'} onChange={() => setExportOption('full_text')} className="accent-[#00a884] w-4 h-4" />
                             <span>Full Chat Export (Text Only)</span>
                           </label>
                           <label className="flex items-center space-x-3 text-sm text-[#e9edef] cursor-pointer hover:bg-[#2a3942] p-2 rounded-md transition-colors">
                             <input type="radio" value="range_media" checked={exportOption === 'range_media'} onChange={() => setExportOption('range_media')} className="accent-[#00a884] w-4 h-4" />
                             <span>Select the Dates with Media</span>
                           </label>
                           <label className="flex items-center space-x-3 text-sm text-[#e9edef] cursor-pointer hover:bg-[#2a3942] p-2 rounded-md transition-colors">
                             <input type="radio" value="range_text" checked={exportOption === 'range_text'} onChange={() => setExportOption('range_text')} className="accent-[#00a884] w-4 h-4" />
                             <span>Select the Dates with Text Only</span>
                           </label>
                         </div>
                         
                         {(exportOption === 'range_media' || exportOption === 'range_text') && (
                           <div className="bg-[#202c33] p-5 rounded-xl border border-[#2a3942] space-y-4 animate-fade-in">
                              <h3 className="text-white font-medium mb-2 border-b border-[#2a3942] pb-2">Date Range</h3>
                              <div className="flex gap-4">
                                <div className="flex-1">
                                   <label className="text-xs text-[#8696a0] mb-1 block uppercase font-bold">From Date</label>
                                   <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full bg-[#111b21] text-[#e9edef] p-2 text-sm rounded outline-none border border-[#2a3942] focus:border-[#00a884]" />
                                </div>
                                <div className="flex-1">
                                   <label className="text-xs text-[#8696a0] mb-1 block uppercase font-bold">To Date</label>
                                   <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full bg-[#111b21] text-[#e9edef] p-2 text-sm rounded outline-none border border-[#2a3942] focus:border-[#00a884]" />
                                </div>
                              </div>
                           </div>
                         )}
                         
                         <div className="bg-[#202c33] p-5 rounded-xl border border-[#2a3942] space-y-4 mt-auto">
                            <label className="text-xs text-[#8696a0] mb-1 block uppercase font-bold">Export Password</label>
                            <input type="password" placeholder="Enter password to encrypt file" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-[#111b21] text-[#e9edef] p-3 text-sm rounded outline-none border border-[#2a3942] focus:border-[#00a884]" />
                            <button onClick={handleExport} disabled={isProcessing} className="w-full py-3 bg-[#00a884] hover:bg-[#06cf9c] text-[#111b21] font-bold rounded shadow-lg disabled:opacity-50 transition-colors">
                               {isProcessing ? 'Processing...' : 'Export File'}
                            </button>
                         </div>
                      </div>
                      
                      {/* Preview Box */}
                      <div className="w-[300px] flex flex-col">
                         <div className="bg-[#202c33] rounded-xl border border-[#2a3942] flex-1 flex flex-col overflow-hidden">
                            <h3 className="text-white font-medium p-4 border-b border-[#2a3942] bg-[#111b21]">Preview of Chat</h3>
                            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#0b141a]">
                              {previewMsgs.length === 0 ? (
                                <p className="text-[#8696a0] text-sm text-center mt-10">No messages in selection</p>
                              ) : (
                                previewMsgs.map((m, i) => (
                                  <div key={i} className={\`max-w-[90%] rounded-lg p-2 text-sm \${m.sender_id === sessionInfo.userId ? 'bg-[#005c4b] ml-auto text-[#e9edef]' : 'bg-[#202c33] text-[#e9edef]'}\`}>
                                    {m.text && <p>{m.text}</p>}
                                    {m.file && <span className="text-xs opacity-70 flex items-center"><Download className="w-3 h-3 mr-1"/> Media ({m.file.type.split('/')[0]})</span>}
                                  </div>
                                ))
                              )}
                            </div>
                         </div>
                      </div>
                   </div>
                ) : (
                   <div className="flex flex-col items-center justify-center h-full max-w-md mx-auto w-full space-y-8 animate-fade-in">
                      <div className="text-center">
                         <Upload className="w-16 h-16 text-[#00a884] mx-auto mb-4 opacity-80" />
                         <h3 className="text-2xl text-white font-bold mb-2">Import Backup</h3>
                         <p className="text-[#8696a0] text-sm">Select a secure .stego audio file to merge into this chat.</p>
                      </div>
                      
                      <div className="w-full bg-[#202c33] p-6 rounded-xl border border-[#2a3942] space-y-6">
                         <div>
                            <label className="text-xs text-[#8696a0] mb-2 block uppercase font-bold">Import Password</label>
                            <input type="password" placeholder="Enter file password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-[#111b21] text-[#e9edef] p-3 text-sm rounded outline-none border border-[#2a3942] focus:border-[#00a884]" />
                         </div>
                         
                         <label className={\`w-full py-4 \${!password ? 'bg-[#111b21] opacity-50 cursor-not-allowed border-[#2a3942]' : 'bg-[#2a3942] hover:bg-[#3a4952] cursor-pointer border-[#00a884] shadow-lg'} text-[#e9edef] border border-dashed rounded-xl flex flex-col items-center justify-center transition-all\`}>
                            {isProcessing ? 'Importing...' : (
                              <>
                                <div className="w-10 h-10 bg-[#00a884] rounded-full flex items-center justify-center mb-2">
                                  <span className="text-white font-bold text-xl">+</span>
                                </div>
                                <span className="font-bold">Import the chat</span>
                              </>
                            )}
                            <input type="file" accept=".stego" className="hidden" onChange={handleImport} disabled={isProcessing || !password} />
                         </label>
                      </div>
                   </div>
                )}
             </div>
          </div>
       </div>
    </div>,
    document.body
  );
};
`;

const oldModalRegex = /const DataManagementModal = \(\{[\s\S]*?return createPortal\([\s\S]*?document\.body\n  \);\n\};\n/m;
content = content.replace(oldModalRegex, newModal);

// Also modify Contact Info sidebar to include the left dropdown menu options.
const contactInfoRegex = /(<div className="flex flex-col items-center py-8 bg-\[#111b21\] shadow-sm">[\s\S]*?<h3 className="text-\[#00a884\] text-sm mb-4">Shared Media<\/h3>)/;
const replacement = `
            <div className="flex flex-col items-center py-8 bg-[#111b21] shadow-sm">
              <div className="w-48 h-48 bg-[#4f5e67] rounded-full flex items-center justify-center mb-4">
                <span className="text-6xl text-[#d1d7db] font-bold">{targetUser.username[0].toUpperCase()}</span>
              </div>
              <h2 className="text-2xl text-[#e9edef] font-medium">{targetUser.username}</h2>
              <p className="text-[#8696a0] text-lg mb-6">{targetUser.email}</p>
            </div>
            
            <div className="mt-2 bg-[#111b21] py-2 shadow-sm">
               <button onClick={() => { setShowReportModal(true); setShowUserProfile(false); }} className="w-full text-left px-6 py-4 text-orange-400 hover:bg-[#202c33] flex items-center gap-4 transition-colors">
                  <Flag className="w-5 h-5" />
                  <span className="font-medium">Report User</span>
               </button>
               <button onClick={handleBlockUser} className="w-full text-left px-6 py-4 text-red-500 hover:bg-[#202c33] flex items-center gap-4 transition-colors">
                  <UserX className="w-5 h-5" />
                  <span className="font-medium">Block User</span>
               </button>
            </div>

            <div className="mt-2 bg-[#111b21] py-4 shadow-sm">
               <div className="px-6 py-2 text-xs text-[#8696a0] font-bold uppercase tracking-wider">Chat Duration</div>
               <button onClick={() => { localStorage.setItem('duration_'+sessionInfo.sessionId, 'permanent'); alert('Chat set to Permanent Storage'); }} className="w-full text-left px-6 py-4 text-white hover:bg-[#202c33] flex items-center gap-4 transition-colors">
                  <ExternalLink className="w-5 h-5 text-[#00a884]" />
                  <span className="font-medium text-sm">Keep Permanent</span>
               </button>
               <button onClick={() => { localStorage.setItem('duration_'+sessionInfo.sessionId, '24h'); alert('Chat set to 24 Hours. Older messages will auto-delete on refresh.'); }} className="w-full text-left px-6 py-4 text-white hover:bg-[#202c33] flex items-center gap-4 transition-colors">
                  <Clock className="w-5 h-5 text-[#00a884]" />
                  <span className="font-medium text-sm">Keep for 24 Hours</span>
               </button>
               
               <div className="px-6 py-4 hover:bg-[#202c33] transition-colors flex items-center justify-between mt-2">
                 <div className="flex items-center gap-4">
                   <Clock className="w-5 h-5 text-orange-400" />
                   <span className="text-sm text-white font-medium">Instant</span>
                 </div>
                 <div className="flex items-center gap-3">
                   <select 
                     className="bg-[#202c33] text-xs font-bold text-orange-400 border border-[#3b4a54] rounded-md px-2 py-1.5 outline-none cursor-pointer"
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
                     className="w-5 h-5 accent-orange-400 cursor-pointer"
                   />
                 </div>
               </div>
            </div>

            <div className="mt-2 bg-[#111b21] py-4 shadow-sm">
               <div className="px-6 py-2 text-xs text-[#8696a0] font-bold uppercase tracking-wider">Data Management</div>
               <button onClick={() => { setShowDataModal(true); setShowUserProfile(false); }} className="w-full text-left px-6 py-4 text-blue-400 hover:bg-[#202c33] flex items-center gap-4 transition-colors">
                  <Download className="w-5 h-5" />
                  <span className="font-medium text-sm">Export / Import Chat</span>
               </button>
            </div>

            <div className="mt-2 bg-[#111b21] p-6 shadow-sm">
              <h3 className="text-[#00a884] text-sm mb-4">Shared Media</h3>
`;
content = content.replace(contactInfoRegex, replacement);

fs.writeFileSync(p, content);
console.log('Replaced DataManagementModal and updated Contact Info.');
