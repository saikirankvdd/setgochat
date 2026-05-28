const fs = require('fs');

let code = fs.readFileSync('src/components/ChatArea.tsx', 'utf8');

const oldModalRegex = /const DataManagementModal = \(\{.*?\}\) => \{[\s\S]*?return createPortal\([\s\S]*?document\.body\n  \);\n\};\n/m;

const newModal = `const DataManagementModal = ({ onClose, sessionInfo, targetUser }: { onClose: () => void, sessionInfo: any, targetUser: any }) => {
  const [exportType, setExportType] = useState<'full' | 'range'>('full');
  const [mediaType, setMediaType] = useState<'text' | 'media'>('text');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exportPassword, setExportPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleExport = async () => {
    if (exportType === 'range' && (!startDate || !endDate)) return alert("Please select start and end dates.");
    if (!exportPassword || exportPassword.length < 6) return alert("Please enter a strong export password (min 6 characters).");
    if (!window.confirm("Do you want to export this chat? This will download a secure .stego audio backup file.")) return;
    
    setIsExporting(true);
    try {
       const msgs = await getAllMessagesLocal();
       let filteredMsgs = msgs.filter(m => m.sessionId === sessionInfo.sessionId);
       
       if (exportType === 'range') {
         const startTs = new Date(startDate).setHours(0,0,0,0);
         const endTs = new Date(endDate).setHours(23,59,59,999);
         filteredMsgs = filteredMsgs.filter(m => m.timestamp >= startTs && m.timestamp <= endTs);
       }
       
       if (mediaType === 'text') {
         filteredMsgs = filteredMsgs.map(m => {
           const { file, encryptedFile, ...rest } = m as any;
           return rest as any;
         });
       }
       
       if (filteredMsgs.length === 0) {
          alert("No messages found to export in that range.");
          setIsExporting(false);
          return;
       }
       
       const { strToU8, gzipSync } = await import('fflate');
       const oneTimeToken = crypto.randomUUID();
       
       const payloadObj = {
         token: oneTimeToken,
         messages: filteredMsgs
       };
       
       const payloadStr = JSON.stringify(payloadObj);
       const compressed = gzipSync(strToU8(payloadStr));
       
       let binaryStr = '';
       for(let i = 0; i < compressed.length; i++){
         binaryStr += String.fromCharCode(compressed[i]);
       }
       const base64Data = btoa(binaryStr);
       
       const encryptedData = encryptData(base64Data, exportPassword);
       if (!encryptedData) throw new Error("Encryption failed");

       const binaryData = stringToBinary(encryptedData);
       const carrier = createDynamicCarrier4Bit(binaryData.length);
       const finalStego = encodeLSB4Bit(carrier, binaryData);
       
       const blob = new Blob([finalStego], { type: 'audio/wav' });
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
    
    if (!importPassword) {
      alert("Please enter the export password first.");
      if (e.target) e.target.value = '';
      return;
    }
    
    if (!window.confirm("Do you want to import this chat backup? Messages will be securely merged into this chat.")) {
      if (e.target) e.target.value = '';
      return;
    }
    setIsImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const hiddenBinary = decodeLSB4Bit(buffer);
      const encryptedData = binaryToString(hiddenBinary);
      
      const base64Data = decryptData(encryptedData, importPassword);
      if (!base64Data) throw new Error("Incorrect password or corrupted file");

      const { gunzipSync, strFromU8 } = await import('fflate');

      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const decompressed = gunzipSync(bytes);
      const jsonStr = strFromU8(decompressed);
      const payload = JSON.parse(jsonStr);
      
      if (!payload.token || !payload.messages) throw new Error("Invalid backup payload");

      const usedTokensStr = localStorage.getItem('used_tokens') || '[]';
      const usedTokens = JSON.parse(usedTokensStr);
      if (usedTokens.includes(payload.token)) {
        throw new Error("This backup file has already been used and cannot be imported again.");
      }

      const msgs = payload.messages;
      if (!Array.isArray(msgs)) throw new Error("Invalid backup format");
      
      await importMessagesLocal(msgs);
      
      usedTokens.push(payload.token);
      localStorage.setItem('used_tokens', JSON.stringify(usedTokens));

      alert(\`Successfully imported \${msgs.length} messages! Reloading...\`);
      window.location.reload(); 
    } catch (err: any) {
      console.error(err);
      alert("Failed to import chats: " + err.message);
    }
    setIsImporting(false);
    if (e.target) e.target.value = '';
  };

  return createPortal(
    <div className="fixed inset-0 bg-[#0b141a]/80 z-[9999] flex items-center justify-center p-4">
       <div className="bg-[#202c33] rounded-2xl w-full max-w-3xl p-6 border border-[#2a3942] shadow-2xl">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-white flex items-center">Data Management</h2>
            <button onClick={onClose} className="text-[#8696a0] hover:text-white">X</button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             {/* EXPORT COLUMN */}
             <div className="bg-[#111b21] p-5 rounded-xl border border-[#2a3942] flex flex-col">
                <h3 className="text-[#e9edef] font-bold mb-2 flex items-center">Export Chat</h3>
                <p className="text-[#8696a0] text-sm mb-4 flex-1">Generate a secure .stego backup file of this chat.</p>
                
                <div className="space-y-3 mb-4">
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
                  <div className="flex gap-2 mb-4">
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

                <div className="space-y-3 mb-4">
                  <label className="flex items-center space-x-3 text-sm text-white cursor-pointer">
                    <input type="radio" name="mediaType" value="text" checked={mediaType === 'text'} onChange={() => setMediaType('text')} className="accent-[#00a884]" />
                    <span>Text Only (Small Size)</span>
                  </label>
                  <label className="flex items-center space-x-3 text-sm text-white cursor-pointer">
                    <input type="radio" name="mediaType" value="media" checked={mediaType === 'media'} onChange={() => setMediaType('media')} className="accent-[#00a884]" />
                    <span>Include Media (Large Size)</span>
                  </label>
                </div>

                <div className="mb-6">
                    <label className="text-xs text-[#8696a0] mb-1 block">Export Password</label>
                    <input type="password" placeholder="Set strong password..." value={exportPassword} onChange={e => setExportPassword(e.target.value)} className="w-full bg-[#202c33] text-white p-2 text-sm rounded outline-none border border-[#3b4a54] focus:border-[#00a884]" />
                </div>
                
                <button onClick={handleExport} disabled={isExporting} className="w-full py-3 bg-[#00a884] hover:bg-[#06cf9c] text-[#111b21] font-bold rounded-lg shadow-lg disabled:opacity-50 transition-colors mt-auto">
                   {isExporting ? 'Exporting...' : 'Export File'}
                </button>
             </div>
             
             {/* IMPORT COLUMN */}
             <div className="bg-[#111b21] p-5 rounded-xl border border-[#2a3942] flex flex-col">
                <h3 className="text-[#e9edef] font-bold mb-2 flex items-center">Import Chat</h3>
                <p className="text-[#8696a0] text-sm mb-6 flex-1">Restore messages from a previous .stego backup file into this session.</p>
                
                <div className="mb-6">
                    <label className="text-xs text-[#8696a0] mb-1 block">Import Password</label>
                    <input type="password" placeholder="Enter password..." value={importPassword} onChange={e => setImportPassword(e.target.value)} className="w-full bg-[#202c33] text-white p-2 text-sm rounded outline-none border border-[#3b4a54] focus:border-[#00a884]" />
                </div>

                <label className="w-full py-3 bg-[#2a3942] hover:bg-[#3a4952] text-white font-bold rounded-lg shadow-lg flex items-center justify-center cursor-pointer transition-colors mt-auto border border-[#3b4a54]">
                   {isImporting ? 'Importing...' : 'Select File & Import'}
                   <input type="file" accept=".stego,.json,.wav" className="hidden" onChange={handleImport} disabled={isImporting} />
                </label>
             </div>
          </div>
       </div>
    </div>,
    document.body
  );
};
`;

code = code.replace(oldModalRegex, newModal);
fs.writeFileSync('src/components/ChatArea.tsx', code);
console.log('Modal patched!');
