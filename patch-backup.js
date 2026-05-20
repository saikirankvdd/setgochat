import fs from 'fs';

const file = 'src/components/ChatArea.tsx';
let code = fs.readFileSync(file, 'utf8');

// 1. Fix handleSendMessage (the previous CodeEdit was not applied automatically)
code = code.replace(
  `        isRevealed: !snapchatMode,
        expiresAt: undefined`,
  `        isRevealed: true,
        expiresAt: snapchatMode ? Date.now() + (timer * 1000) : undefined`
);

// 2. Remove BackupModal component completely
const backupModalRegex = /\nconst BackupModal = \(\{ onClose, sessionInfo \}: \{ onClose: \(\) => void, sessionInfo: any \}\) => \{[\s\S]*?\n\};\n/;
code = code.replace(backupModalRegex, '\n');

// 3. Remove showBackupModal state
code = code.replace(
  `  const [showBackupModal, setShowBackupModal] = useState(false);`,
  ``
);

// 4. Remove BackupModal render in return statement
code = code.replace(
  `      {showBackupModal && <BackupModal onClose={() => setShowBackupModal(false)} sessionInfo={sessionInfo} />}\n`,
  ``
);
// just in case it didn't have \n
code = code.replace(
  `{showBackupModal && <BackupModal onClose={() => setShowBackupModal(false)} sessionInfo={sessionInfo} />}`,
  ``
);

// 5. Add handleExport and handleImport to ChatArea
const chatExportImportLogic = `
  const handleExport = async () => {
    if (!window.confirm("Do you want to export this chat? This will download a secure .stego backup file.")) return;
    try {
       const msgs = await getAllMessagesLocal();
       const filteredMsgs = msgs.filter(m => m.sessionId === sessionInfo.sessionId);
       
       if (filteredMsgs.length === 0) {
          alert("No messages found to export.");
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
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!window.confirm("Do you want to import this chat backup? Messages will be securely merged into this chat.")) return;
    
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
  };
`;

// Insert the new logic right after `const endCall = () => { ... }`
if (!code.includes('const handleExport = async () => {')) {
  code = code.replace(
    /const endCall = \(\) => \{[\s\S]*?\};/,
    `$&${chatExportImportLogic}`
  );
}

// 6. Update the dropdown menu buttons
code = code.replace(
  `<button onClick={() => { setShowBackupModal(true); setShowDropdown(false); }} className="w-full text-left px-4 py-3 text-blue-400 text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors">
                      <Download className="w-4 h-4" />
                      Export / Import Chat
                   </button>`,
  `<button onClick={() => { handleExport(); setShowDropdown(false); }} className="w-full text-left px-4 py-3 text-blue-400 text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors border-b border-[#202c33]">
                      <Download className="w-4 h-4" />
                      Export Chat
                   </button>
                   <label className="w-full text-left px-4 py-3 text-green-400 text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors cursor-pointer">
                      <Upload className="w-4 h-4" />
                      Import Chat
                      <input type="file" accept=".stego,.json" className="hidden" onChange={(e) => { handleImport(e); setShowDropdown(false); }} />
                   </label>`
);

fs.writeFileSync(file, code);
console.log('ChatArea successfully patched');
