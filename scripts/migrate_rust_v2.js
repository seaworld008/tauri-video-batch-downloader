import fs from 'fs';
import path from 'path';

function walkSync(dir, filelist = []) {
    fs.readdirSync(dir).forEach(file => {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            if (file !== 'target' && file !== 'node_modules') walkSync(filePath, filelist);
        } else {
            if (filePath.endsWith('.rs')) {
                filelist.push(filePath);
            }
        }
    });
    return filelist;
}

const files = walkSync('./src-tauri/src');
let count = 0;
for (const file of files) {
    let content = fs.readFileSync(file, 'utf-8');
    const initial = content;
    content = content.replace(/\.emit_all\(/g, '.emit(');

    if (content !== initial) {
        if (!content.includes('use tauri::Emitter;')) {
            // Safely insert it after the first use statement or at the top
            content = 'use tauri::Emitter;\n' + content;
        }
        fs.writeFileSync(file, content);
        count++;
    }
}
console.log(`Updated ${count} files for Rust tauri emit_all -> emit migration.`);
