import fs from 'fs';

const file = 'src/components/ChatArea.tsx';
let code = fs.readFileSync(file, 'utf8');

// Fix interface Message
code = code.replace(
  `interface Message {
  id: string;
  fromId: number;
  text: string;`,
  `interface Message {
  id: string;
  fromId: string | number;
  toId?: string | number;
  text: string;`
);

// Fix loadLocalMessages
code = code.replace(
  `          decryptedMsgs.push({
            id: msg.id,
            fromId: parseInt(msg.fromId),
            toId: parseInt(msg.toId),`,
  `          decryptedMsgs.push({
            id: msg.id,
            fromId: msg.fromId,
            toId: msg.toId,`
);

fs.writeFileSync(file, code);
console.log("Patched string bug successfully.");
