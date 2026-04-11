import fs from 'fs';

const filePath = 'server.ts';
let code = fs.readFileSync(filePath, 'utf8');

// 1. Add escapeRegex helper at the top
if (!code.includes('escapeRegex')) {
    const importMatch = code.match(/import 'dotenv\/config';\r?\n/);
    if (importMatch) {
         const insertPos = importMatch.index + importMatch[0].length;
         const helperCode = `\n// Helper to prevent ReDoS\nconst escapeRegex = (str: string) => str.replace(/[.*+?^$\\{}()|[\\]\\\\]/g, '\\\\$&');\n`;
         code = code.slice(0, insertPos) + helperCode + code.slice(insertPos);
    }
}

// 2. Fix all new RegExp(\`^\\${var}$\`, 'i') to use escapeRegex
code = code.replace(/new\s+RegExp\(\s*`\^\\\$\{(.+?)\}\\\$`\s*,\s*'i'\s*\)/g, "new RegExp(`^\\${escapeRegex($1)}$`, 'i')");

// Fix remaining cases that might not have ^ or $ exactly:
// Specifically for the block in app.get('/api/users')
code = code.replace(/new\s+RegExp\(\s*'\^saikirankvdd13@gmail\\\\.com\$'\s*,\s*'i'\s*\)/g, "new RegExp('^saikirankvdd13@gmail\\\\.com$', 'i')");
code = code.replace(/new\s+RegExp\(\s*'\^admin_saikiran\$'\s*,\s*'i'\s*\)/g, "new RegExp('^admin_saikiran$', 'i')");

// 3. Fix maxHttpBufferSize & express.json limits
code = code.replace(/maxHttpBufferSize:\s*1e8[^\n]*/g, "maxHttpBufferSize: 5 * 1024 * 1024 // Reduced to 5MB to prevent DoS");
code = code.replace(/app\.use\(express\.json\(\{ limit:\s*'100mb'\s*\}\)\);/g, "app.use(express.json({ limit: '2mb' })); // Reduced to 2MB to prevent OOM DoS");

// 4. Fix OfflineMessage creation to enforce limits
const oldSendFileOffline = `await OfflineMessage.create({ to_id: safeData.toId, payload: JSON.stringify({ type: 'file', data: safeData }) });`;
const newSendFileOffline = `const count = await OfflineMessage.countDocuments({ to_id: safeData.toId });\n      if (count < 20) {\n        await OfflineMessage.create({ to_id: safeData.toId, payload: JSON.stringify({ type: 'file', data: safeData }) });\n      }`;
code = code.replace(oldSendFileOffline, newSendFileOffline);

const oldSendTextOffline = `await OfflineMessage.create({ to_id: safeData.toId, payload: JSON.stringify({ type: 'text', data: safeData }) });`;
const newSendTextOffline = `const tCount = await OfflineMessage.countDocuments({ to_id: safeData.toId });\n      if (tCount < 50) {\n        await OfflineMessage.create({ to_id: safeData.toId, payload: JSON.stringify({ type: 'text', data: safeData }) });\n      }`;
code = code.replace(oldSendTextOffline, newSendTextOffline);

fs.writeFileSync(filePath, code, 'utf8');
console.log('Patch applied successfully!');
