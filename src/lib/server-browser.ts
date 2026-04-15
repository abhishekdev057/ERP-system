import fs from "fs";
import path from "path";
import puppeteer, { Browser, LaunchOptions } from "puppeteer";

const DEFAULT_BROWSER_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--no-zygote",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--disable-web-security",
];

function getExecutableCandidates(): string[] {
    const envCandidates = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        process.env.CHROME_BIN,
        process.env.CHROMIUM_PATH,
        process.env.GOOGLE_CHROME_BIN,
    ].filter((value): value is string => Boolean(value && value.trim()));

    const systemCandidates = [
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-beta",
        "/usr/bin/google-chrome-unstable",
        "/opt/google/chrome/chrome",
        "/opt/google/chrome/google-chrome",
        "/usr/bin/chrome",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/usr/bin/chromium-headless-shell",
        "/usr/lib/chromium/chrome",
        "/usr/lib64/chromium/chrome",
        "/snap/bin/chromium",
    ];

    const candidates = [...envCandidates];

    try {
        const bundledPath = puppeteer.executablePath();
        if (bundledPath) {
            candidates.push(bundledPath);
        }
    } catch {
        // Ignore bundled-browser lookup failures and continue with other candidates.
    }

    for (const candidate of systemCandidates) {
        if (fs.existsSync(candidate)) {
            candidates.push(candidate);
        }
    }

    return Array.from(new Set(candidates.map((candidate) => path.resolve(candidate))));
}

export async function launchServerBrowser(context: string, options: LaunchOptions = {}): Promise<Browser> {
    const attempted: string[] = [];
    const launchArgs = Array.from(new Set([...(options.args || []), ...DEFAULT_BROWSER_ARGS]));
    const candidates = getExecutableCandidates();

    for (const executablePath of candidates) {
        attempted.push(executablePath);
        try {
            return await puppeteer.launch({
                headless: true,
                ...options,
                args: launchArgs,
                executablePath,
                protocolTimeout: Math.max(120000, options.protocolTimeout || 0),
            });
        } catch (error) {
            console.warn(`[BrowserLauncher] Failed to launch ${context} with ${executablePath}:`, error);
        }
    }

    try {
        return await puppeteer.launch({
            headless: true,
            ...options,
            args: launchArgs,
            protocolTimeout: Math.max(120000, options.protocolTimeout || 0),
        });
    } catch (error) {
        const attemptedList = attempted.length > 0 ? attempted.join(", ") : "default Puppeteer browser";
        const reason = error instanceof Error ? error.message : String(error);
        const linuxHint = process.platform === "linux"
            ? " On Ubuntu/Debian, install the required Chrome dependencies first, for example: " +
              "`bash scripts/install-puppeteer-deps-ubuntu.sh` or inspect missing libraries with " +
              "`ldd <chrome-binary> | grep not`."
            : "";
        throw new Error(
            `Unable to launch a headless browser for ${context}. Tried: ${attemptedList}. ` +
            `Set PUPPETEER_EXECUTABLE_PATH to a valid Chrome/Chromium binary on the server. ` +
            `Last error: ${reason}${linuxHint}`
        );
    }
}
