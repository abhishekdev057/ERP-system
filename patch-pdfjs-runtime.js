const fs = require("fs");
const path = require("path");

function patchFile(filePath, target, replacement, label) {
    if (!fs.existsSync(filePath)) {
        console.log(`${label}: file not found, skipping.`);
        return;
    }

    const content = fs.readFileSync(filePath, "utf8");
    if (content.includes(replacement)) {
        console.log(`${label}: already patched.`);
        return;
    }
    if (!content.includes(target)) {
        console.log(`${label}: target snippet not found.`);
        return;
    }

    const next = content.replace(target, replacement);
    fs.writeFileSync(filePath, next);
    console.log(`${label}: patched successfully.`);
}

const repoRoot = __dirname;

const pdfjsTargets = [
    path.join(
        repoRoot,
        "node_modules",
        "react-pdf",
        "node_modules",
        "pdfjs-dist",
        "build",
        "pdf.mjs"
    ),
    path.join(repoRoot, "node_modules", "pdfjs-dist", "build", "pdf.mjs"),
];

const shadowTarget = `function shadow(obj, prop, value, nonSerializable = false) {
  Object.defineProperty(obj, prop, {
    value,
    enumerable: !nonSerializable,
    configurable: true,
    writable: false
  });
  return value;
}`;

const shadowPatched = `function shadow(obj, prop, value, nonSerializable = false) {
  if (!obj || typeof obj !== "object" && typeof obj !== "function") {
    return value;
  }
  Object.defineProperty(obj, prop, {
    value,
    enumerable: !nonSerializable,
    configurable: true,
    writable: false
  });
  return value;
}`;

pdfjsTargets.forEach((filePath) => {
    patchFile(filePath, shadowTarget, shadowPatched, `pdfjs shadow guard (${path.basename(path.dirname(filePath))})`);
});

const reactPdfUtilsPath = path.join(
    repoRoot,
    "node_modules",
    "react-pdf",
    "dist",
    "shared",
    "utils.js"
);

const makePageTarget = `export function makePageCallback(page, scale) {
    Object.defineProperty(page, 'width', {
        get() {
            return this.getViewport({ scale }).width;
        },
        configurable: true,
    });`;

const makePagePatched = `export function makePageCallback(page, scale) {
    if (!page || (typeof page !== 'object' && typeof page !== 'function')) {
        return page;
    }
    Object.defineProperty(page, 'width', {
        get() {
            return this.getViewport({ scale }).width;
        },
        configurable: true,
    });`;

patchFile(
    reactPdfUtilsPath,
    makePageTarget,
    makePagePatched,
    "react-pdf makePageCallback guard"
);
