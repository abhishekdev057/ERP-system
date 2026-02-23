const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'node_modules', 'fontkit', 'dist', 'main.cjs');

if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    const target = 'getAnchor(anchor) {';
    const patch = 'getAnchor(anchor) {\n        if (!anchor) return { x: 0, y: 0 };';

    if (content.includes(target) && !content.includes(patch)) {
        content = content.replace(target, patch);
        fs.writeFileSync(filePath, content);
        console.log('Successfully patched fontkit to handle null anchors.');
    } else if (content.includes(patch)) {
        console.log('Fontkit is already patched.');
    } else {
        console.log('Could not find target content in fontkit to patch.');
    }
} else {
    console.log('fontkit main.cjs not found. Skipping patch.');
}
