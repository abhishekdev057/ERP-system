const fs = require("fs");
const path = require("path");

const repoRoot = __dirname;
const outputDir = path.join(repoRoot, "public", "pdfjs");
fs.mkdirSync(outputDir, { recursive: true });

const fileMappings = [
    {
        label: "runtime",
        candidates: [
            path.join(repoRoot, "node_modules", "pdfjs-dist", "build", "pdf.mjs"),
            path.join(repoRoot, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs"),
        ],
        output: path.join(outputDir, "pdf.mjs"),
    },
    {
        label: "worker",
        candidates: [
            path.join(repoRoot, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs"),
            path.join(repoRoot, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.min.mjs"),
        ],
        output: path.join(outputDir, "pdf.worker.min.mjs"),
    },
];

for (const mapping of fileMappings) {
    const source = mapping.candidates.find((candidate) => fs.existsSync(candidate));
    if (!source) {
        console.log(`pdfjs ${mapping.label} sync: source file not found, skipping.`);
        continue;
    }
    fs.copyFileSync(source, mapping.output);
    console.log(
        `pdfjs ${mapping.label} sync: copied ${path.relative(repoRoot, source)} -> ${path.relative(repoRoot, mapping.output)}`
    );
}

const directoryMappings = [
    {
        label: "cmaps",
        source: path.join(repoRoot, "node_modules", "pdfjs-dist", "cmaps"),
        output: path.join(outputDir, "cmaps"),
    },
    {
        label: "standard fonts",
        source: path.join(repoRoot, "node_modules", "pdfjs-dist", "standard_fonts"),
        output: path.join(outputDir, "standard_fonts"),
    },
    {
        label: "wasm",
        source: path.join(repoRoot, "node_modules", "pdfjs-dist", "wasm"),
        output: path.join(outputDir, "wasm"),
    },
];

for (const mapping of directoryMappings) {
    if (!fs.existsSync(mapping.source)) {
        console.log(`pdfjs ${mapping.label} sync: source directory not found, skipping.`);
        continue;
    }

    fs.cpSync(mapping.source, mapping.output, { recursive: true, force: true });
    console.log(
        `pdfjs ${mapping.label} sync: copied ${path.relative(repoRoot, mapping.source)} -> ${path.relative(repoRoot, mapping.output)}`
    );
}
