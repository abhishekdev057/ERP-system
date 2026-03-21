const puppeteer = require("puppeteer");

(async () => {
    console.log("Launching puppeteer...");
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--allow-file-access-from-files",
            "--disable-web-security"
        ],
    });

    console.log("Generating dummy HTML...");
    let html = `<!DOCTYPE html><html><head><style>.slide { width: 297mm; height: 210mm; page-break-after: always; }</style></head><body>`;
    for (let i = 0; i < 100; i++) {
        html += `<div class="slide"><h1>Slide ${i}</h1><img src="https://via.placeholder.com/800" /></div>`;
    }
    html += `</body></html>`;

    let page;
    try {
        page = await browser.newPage();

        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
        page.on('requestfailed', request => console.log('FAILED REQUEST:', request.url(), request.failure().errorText));

        console.log("Setting content...");
        await page.setContent(html, { waitUntil: 'load', timeout: 120000 });

        console.log("Evaluating...");
        await page.evaluateHandle("document.fonts.ready");

        console.log("Generating PDF...");
        const pdf = await page.pdf({
            width: "297mm",
            height: "210mm",
            printBackground: true,
            preferCSSPageSize: true,
            margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
            timeout: 120000,
        });

        console.log(`PDF Generated! Size: ${(pdf.length / 1024 / 1024).toFixed(2)} MB`);
    } catch (e) {
        console.error("Crash!", e);
    } finally {
        await browser.close();
    }
})();
