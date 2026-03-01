import fs from 'fs';
import path from 'path';

function walkSync(dir, filelist = []) {
    fs.readdirSync(dir).forEach(file => {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            if (file !== 'node_modules' && file !== 'dist') walkSync(filePath, filelist);
        } else {
            if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
                filelist.push(filePath);
            }
        }
    });
    return filelist;
}

const files = walkSync('./src');
let changedCount = 0;

for (const file of files) {
    let content = fs.readFileSync(file, 'utf-8');
    const initial = content;

    // Replace @tauri-apps/api/tauri with @tauri-apps/api/core
    content = content.replace(/['"]@tauri-apps\/api\/tauri['"]/g, "'@tauri-apps/plugin-core'");

    // Actually, wait, invoke is in @tauri-apps/api/core in v2
    content = content.replace(/['"]@tauri-apps\/plugin-core['"]/g, "'@tauri-apps/api/core'");

    // Replace dialog
    content = content.replace(/['"]@tauri-apps\/api\/dialog['"]/g, "'@tauri-apps/plugin-dialog'");

    // Replace window
    content = content.replace(/import\s+\{\s*appWindow\s*\}\s+from\s+['"]@tauri-apps\/api\/window['"]/g, "import { getCurrentWindow } from '@tauri-apps/api/window'");
    content = content.replace(/appWindow\./g, 'getCurrentWindow().');
    content = content.replace(/appWindow,/g, 'getCurrentWindow(),');

    if (content !== initial) {
        fs.writeFileSync(file, content);
        changedCount++;
    }
}

console.log(`Updated ${changedCount} files for Tauri v2 import migration.`);
