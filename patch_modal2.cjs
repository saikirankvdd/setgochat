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
    <div className="fixed inset-0 bg-[#0b141a]/80 z-[9999] flex items-center justify-center p-4">
       <div className="bg-[#202c33] rounded-2xl w-full max-w-lg border border-[#2a3942] shadow-2xl flex flex-col overflow-hidden">
          <div className="flex justify-between items-center p-6 border-b border-[#2a3942]">
            <h2 className="text-xl font-bold text-white flex items-center"><Download className="w-5 h-5 mr-2 text-[#00a884]"/> Data Management</h2>
            <button onClick={onClose} className="text-[#8696a0] hover:text-white"><X className="w-6 h-6"/></button>
          </div>
          
          <div className="flex bg-[#111b21]">
             <button 
               onClick={() => setActiveTab('export')}
               className={\`flex-1 py-3 text-sm font-medium transition-colors \${activeTab === 'export' ? 'text-[#00a884] border-b-2 border-[#00a884]' : 'text-[#8696a0] hover:text-[#d1d7db]'}\`}
             >
               Export
             </button>
             <button 
               onClick={() => setActiveTab('import')}
               className={\`flex-1 py-3 text-sm font-medium transition-colors \${activeTab === 'import' ? 'text-[#00a884] border-b-2 border-[#00a884]' : 'text-[#8696a0] hover:text-[#d1d7db]'}\`}
             >
               Import
             </button>
          </div>
          
          <div className="p-6">
             {activeTab === 'export' ? (
                <div className="flex flex-col space-y-4">
                   <p className="text-[#8696a0] text-sm">Generate a secure, encrypted audio steganography file (.stego) containing this chat.</p>
                   
                   <div className="space-y-3 bg-[#111b21] p-4 rounded-lg border border-[#2a3942]">
                     <label className="flex items-center space-x-3 text-sm text-[#e9edef] cursor-pointer">
                       <input type="radio" value="full_media" checked={exportOption === 'full_media'} onChange={() => setExportOption('full_media')} className="accent-[#00a884]" />
                       <span>Full Chat (With Media)</span>
                     </label>
                     <label className="flex items-center space-x-3 text-sm text-[#e9edef] cursor-pointer">
                       <input type="radio" value="full_text" checked={exportOption === 'full_text'} onChange={() => setExportOption('full_text')} className="accent-[#00a884]" />
                       <span>Full Chat (Text Only)</span>
                     </label>
                     <label className="flex items-center space-x-3 text-sm text-[#e9edef] cursor-pointer">
                       <input type="radio" value="range_media" checked={exportOption === 'range_media'} onChange={() => setExportOption('range_media')} className="accent-[#00a884]" />
                       <span>Select Dates (With Media)</span>
                     </label>
                     <label className="flex items-center space-x-3 text-sm text-[#e9edef] cursor-pointer">
                       <input type="radio" value="range_text" checked={exportOption === 'range_text'} onChange={() => setExportOption('range_text')} className="accent-[#00a884]" />
                       <span>Select Dates (Text Only)</span>
                     </label>
                   </div>
                   
                   {(exportOption === 'range_media' || exportOption === 'range_text') && (
                     <div className="flex gap-2">
                        <div className="flex-1">
                           <label className="text-xs text-[#8696a0] mb-1 block">From</label>
                           <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full bg-[#2a3942] text-[#e9edef] p-2 text-sm rounded outline-none border border-transparent focus:border-[#00a884]" />
                        </div>
                        <div className="flex-1">
                           <label className="text-xs text-[#8696a0] mb-1 block">To</label>
                           <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full bg-[#2a3942] text-[#e9edef] p-2 text-sm rounded outline-none border border-transparent focus:border-[#00a884]" />
                        </div>
                     </div>
                   )}

                   <div>
                      <label className="text-xs text-[#8696a0] mb-1 block">Export Password</label>
                      <input type="password" placeholder="Enter password to secure file" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-[#2a3942] text-[#e9edef] p-2 text-sm rounded outline-none border border-transparent focus:border-[#00a884]" />
                   </div>
                   
                   <button onClick={handleExport} disabled={isProcessing} className="w-full py-3 bg-[#00a884] hover:bg-[#06cf9c] text-white font-bold rounded shadow-lg disabled:opacity-50 transition-colors mt-2">
                      {isProcessing ? 'Processing (this may take a moment)...' : 'Export File'}
                   </button>
                </div>
             ) : (
                <div className="flex flex-col space-y-4">
                   <p className="text-[#8696a0] text-sm">Restore your messages from a .stego backup file using the password you set during export.</p>
                   
                   <div>
                      <label className="text-xs text-[#8696a0] mb-1 block">Import Password</label>
                      <input type="password" placeholder="Enter file password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-[#2a3942] text-[#e9edef] p-2 text-sm rounded outline-none border border-transparent focus:border-[#00a884]" />
                   </div>
                   
                   <label className={\`w-full py-3 \${!password ? 'bg-[#2a3942] opacity-50 cursor-not-allowed' : 'bg-[#2a3942] hover:bg-[#3a4952] cursor-pointer'} text-white font-bold rounded shadow-lg flex items-center justify-center transition-colors mt-2\`}>
                      {isProcessing ? 'Importing...' : <><Upload className="w-4 h-4 mr-2" /> Select File & Import</>}
                      <input type="file" accept=".stego" className="hidden" onChange={handleImport} disabled={isProcessing || !password} />
                   </label>
                </div>
             )}
          </div>
       </div>
    </div>,
    document.body
  );
};
`;

const oldModalRegex = /const DataManagementModal = \(\{[\s\S]*?return createPortal\([\s\S]*?document\.body\n  \);\n\};\n/m;
content = content.replace(oldModalRegex, newModal);
fs.writeFileSync(p, content);
console.log('Replaced DataManagementModal');
