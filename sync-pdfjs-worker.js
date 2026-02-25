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
