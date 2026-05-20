import fs from 'fs';

const file = 'src/components/ChatArea.tsx';
let code = fs.readFileSync(file, 'utf8');

// 1. Purge old ghost messages on load
code = code.replace(
  `          if (msg.expiresAt && msg.expiresAt < now) {
            await deleteMessageLocal(msg.id);
            continue;
          }`,
  `          if (msg.expiresAt && msg.expiresAt < now) {
            await deleteMessageLocal(msg.id);
            continue;
          }
          if (msg.isSelfDestruct) {
            // Purge old ghost Snapchat messages from DB
            await deleteMessageLocal(msg.id);
            continue;
          }`
);

// 2. Fix the button that triggers the Data Management modal
code = code.replace(
  `                   <button onClick={() => { setShowBackupModal(true); setShowDropdown(false); }} className="w-full text-left px-4 py-3 text-blue-400 text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors">
                      <Download className="w-4 h-4" />
                      Export / Import Chat
                   </button>`,
  `                   <button onClick={() => { setShowDataModal(true); setShowDropdown(false); }} className="w-full text-left px-4 py-3 text-blue-400 text-sm hover:bg-[#202c33] flex items-center gap-3 transition-colors">
                      <Download className="w-4 h-4" />
                      Export / Import Chat
                   </button>`
);

fs.writeFileSync(file, code);
console.log('Successfully fixed UI bugs.');
