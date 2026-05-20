import fs from 'fs';

const file = 'src/components/Sidebar.tsx';
let code = fs.readFileSync(file, 'utf8');

// 1. Add db imports
if (!code.includes('getAllMessagesLocal')) {
  code = code.replace(
    `import { Search, MoreVertical, MessageSquare, User as UserIcon, Activity, ArrowLeft, Key, Phone, PhoneMissed, PhoneIncoming, PhoneOutgoing, UserPlus, LogOut, X, ShieldAlert } from 'lucide-react';`,
    `import { Search, MoreVertical, MessageSquare, User as UserIcon, Activity, ArrowLeft, Key, Phone, PhoneMissed, PhoneIncoming, PhoneOutgoing, UserPlus, LogOut, X, ShieldAlert, Download, Upload } from 'lucide-react';
import { getAllMessagesLocal, importMessagesLocal } from '../utils/db';`
  );
}

// 2. Add BackupModal component
const backupModalStr = `
const BackupModal = ({ onClose, currentUser }: { onClose: () => void, currentUser: User }) => {
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
       const filteredMsgs = msgs.filter(m => m.timestamp >= startTs && m.timestamp <= endTs);
       
       if (filteredMsgs.length === 0) {
          alert("No messages found in that date range.");
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
      window.location.reload(); // reload to reflect new DB state in chat
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

if (!code.includes('BackupModal')) {
  // Insert right before export function Sidebar
  code = code.replace(/export function Sidebar/, backupModalStr + '\nexport function Sidebar');
}

// 3. Add state to Sidebar component
if (!code.includes('showBackupModal')) {
  code = code.replace(
    `const [showBlockedUsersModal, setShowBlockedUsersModal] = useState(false);`,
    `const [showBlockedUsersModal, setShowBlockedUsersModal] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);`
  );
}

// 4. Add "Chat Backup" to the dropdown menu (line 343 or similar)
// Let's find: `onClick={() => { setShowFeedbackModal(true); setShowDropdown(false); }}`
code = code.replace(
  `<button onClick={() => { setShowFeedbackModal(true); setShowDropdown(false); }} className="block w-full text-left px-4 py-3 text-sm text-[#d1d7db] hover:bg-[#202c33] transition-colors">Submit Feedback</button>`,
  `<button onClick={() => { setShowFeedbackModal(true); setShowDropdown(false); }} className="block w-full text-left px-4 py-3 text-sm text-[#d1d7db] hover:bg-[#202c33] transition-colors border-b border-[#202c33]">Submit Feedback</button>
                    <button onClick={() => { setShowBackupModal(true); setShowDropdown(false); }} className="block w-full text-left px-4 py-3 text-sm text-blue-400 hover:bg-[#202c33] transition-colors flex items-center gap-2 font-medium">
                       <Download className="w-4 h-4" /> Export / Import Chats
                    </button>`
);

// 5. Render modal
if (!code.includes('showBackupModal && <BackupModal')) {
  code = code.replace(
    `{showBlockedUsersModal && <BlockedUsersModal onClose={() => setShowBlockedUsersModal(false)} users={blockedUsersList} onSelect={onSelectUser} />}`,
    `{showBlockedUsersModal && <BlockedUsersModal onClose={() => setShowBlockedUsersModal(false)} users={blockedUsersList} onSelect={onSelectUser} />}
      {showBackupModal && <BackupModal onClose={() => setShowBackupModal(false)} currentUser={currentUser} />}`
  );
}

fs.writeFileSync(file, code);
console.log('Sidebar successfully patched');
