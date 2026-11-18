/**
 * Bank Logo Fetcher V3.1 - Enhanced URLs
 *
 * Downloads "actual" logos for Zambian banks using specific discovered URLs and APIs.
 * Uses atomic writes and fallback logic.
 */

import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BANKS_DIR = path.join(
  __dirname,
  "..",
  "client",
  "public",
  "logos",
  "banks"
);
const MOBILE_MONEY_DIR = path.join(
  __dirname,
  "..",
  "client",
  "public",
  "logos",
  "mobile-money"
);

// Specific discovered URLs for hard-to-find logos
const DIRECT_URLS = {
  // Banks
  "access-bank.png":
    "https://logos-download.com/wp-content/uploads/2016/12/Access_Bank_PLC_Logo.png",
  "atlas-mara.png":
    "https://upload.wikimedia.org/wikipedia/commons/e/ec/BancABC_Logo.png",
  "bank-of-china.png":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/Bank_of_China_logo.svg/512px-Bank_of_China_logo.svg.png",
  "uba.png":
    "https://logos-download.com/wp-content/uploads/2016/09/United_Bank_for_Africa_logo_UBA.png",
  "zanaco.png": "", // Manually uploaded - skipping download
  "investrust.png":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Investrust_Bank_Logo.jpg/240px-Investrust_Bank_Logo.jpg",

  // Mobile Money
  "airtel-money.png":
    "https://logos-download.com/wp-content/uploads/2016/03/Airtel_logo_logotype.png",
  "zamtel-money.png": "https://logodix.com/logo/2012061.png",
};

// Zambian banks with their official domains
const ZAMBIAN_BANKS = [
  { name: "Absa Bank Zambia", domain: "absa.co.zm", filename: "absa.png" },
  {
    name: "Access Bank Zambia",
    domain: "accessbankplc.com",
    filename: "access-bank.png",
  },
  {
    name: "Atlas Mara (BancABC)",
    domain: "bancabc.com",
    filename: "atlas-mara.png",
  },
  {
    name: "Bank of China (Zambia)",
    domain: "boc.cn",
    filename: "bank-of-china.png",
  },
  { name: "Citibank Zambia", domain: "citibank.com", filename: "citibank.png" },
  { name: "Ecobank Zambia", domain: "ecobank.com", filename: "ecobank.png" },
  {
    name: "First Capital Bank",
    domain: "firstcapitalbank.co.zm",
    filename: "first-capital.png",
  },
  {
    name: "First National Bank (FNB)",
    domain: "fnbzambia.co.zm",
    filename: "fnb.png",
  },
  {
    name: "Indo-Zambia Bank",
    domain: "izb.co.zm",
    filename: "indo-zambia.png",
  },
  {
    name: "Investrust Bank",
    domain: "investrustbank.com",
    filename: "investrust.png",
  },
  {
    name: "Stanbic Bank Zambia",
    domain: "stanbicbank.co.zm",
    filename: "stanbic.png",
  },
  {
    name: "Standard Chartered Bank",
    domain: "sc.com",
    filename: "standard-chartered.png",
  },
  {
    name: "United Bank for Africa (UBA)",
    domain: "ubagroup.com",
    filename: "uba.png",
  },
  { name: "ZANACO", domain: "zanaco.co.zm", filename: "zanaco.png" },
];

const MOBILE_MONEY_PROVIDERS = [
  {
    name: "Airtel Money",
    domain: "africa.airtel.com",
    filename: "airtel-money.png",
  },
  { name: "MTN MoMo", domain: "mtn.com", filename: "mtn-momo.png" },
  {
    name: "Zamtel Money",
    domain: "zamtel.co.zm",
    filename: "zamtel-money.png",
  },
];

// Logo API sources (in order of preference)
const LOGO_APIS = [
  // Google High-Res API (Best for "real" logos)
  (domain) =>
    `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain}&size=256`,

  // Clearbit (Backup)
  (domain) => `https://logo.clearbit.com/${domain}`,

  // Google Standard S2 (Fallback)
  (domain) => `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
];

function ensureDirectories() {
  if (!fs.existsSync(BANKS_DIR)) fs.mkdirSync(BANKS_DIR, { recursive: true });
  if (!fs.existsSync(MOBILE_MONEY_DIR))
    fs.mkdirSync(MOBILE_MONEY_DIR, { recursive: true });
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const options = {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    };

    const request = protocol.get(url, options, (response) => {
      // Follow redirects
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        return downloadFile(response.headers.location, destination)
          .then(resolve)
          .catch(reject);
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      const fileStream = fs.createWriteStream(destination);
      response.pipe(fileStream);
      fileStream.on("finish", () => {
        fileStream.close();
        resolve(destination);
      });
      fileStream.on("error", (err) => {
        fs.unlink(destination, () => {});
        reject(err);
      });
    });
    request.on("error", reject);
    request.setTimeout(15000, () => {
      request.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

function isPngOrJpg(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size > 500; // Filter out tiny invalid files/pixels
  } catch (e) {
    return false;
  }
}

async function fetchLogo(item, dir) {
  // Use manual logic for ZANACO (skip)
  if (item.filename === "zanaco.png") {
    if (fs.existsSync(path.join(dir, "zanaco.png"))) {
      console.log(`📥 ${item.name}`);
      console.log(`  ✓ Skipping (Manual upload preserved)`);
      return true;
    }
  }

  const destination = path.join(dir, item.filename);
  const tempDest = destination + ".tmp";

  console.log(`📥 ${item.name}`);

  // 1. Try Specific Direct URL first
  if (DIRECT_URLS[item.filename]) {
    const url = DIRECT_URLS[item.filename];
    // console.log(`  Trying direct URL: ${url}`);

    // Check if URL is empty (skip signal)
    if (!url) {
      console.log(`  ✓ Skipping (Manual config)`);
      return true;
    }

    try {
      if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest);
      await downloadFile(url, tempDest);
      if (isPngOrJpg(tempDest)) {
        if (fs.existsSync(destination)) fs.unlinkSync(destination);
        fs.renameSync(tempDest, destination);
        console.log(`  ✓ Success! (Direct match)`);
        return true;
      } else {
        if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest);
      }
    } catch (e) {
      // console.log(`  ✗ Direct URL failed: ${e.message}`);
      if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest);
    }
  }

  // 2. Try Generic API patterns
  for (let i = 0; i < LOGO_APIS.length; i++) {
    const apiUrl = LOGO_APIS[i](item.domain);
    try {
      if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest);
      await downloadFile(apiUrl, tempDest);
      if (isPngOrJpg(tempDest)) {
        if (fs.existsSync(destination)) fs.unlinkSync(destination);
        fs.renameSync(tempDest, destination);
        console.log(`  ✓ Success! (Source ${i + 1})`);
        return true;
      } else {
        if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest);
      }
    } catch (e) {
      if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest);
    }
  }

  if (fs.existsSync(destination)) {
    console.log(`  ⚠️  Using existing logo (AI generated or previous)`);
    return true;
  }

  console.log(`  ❌ Could not find logo`);
  return false;
}

async function main() {
  console.log("🏦 Fetching ACTUAL Bank Logos (V3.1)...\n");
  ensureDirectories();

  let success = 0;
  let total = 0;

  for (const bank of ZAMBIAN_BANKS) {
    if (await fetchLogo(bank, BANKS_DIR)) success++;
    total++;
  }

  console.log("\n--- Mobile Money ---\n");
  for (const provider of MOBILE_MONEY_PROVIDERS) {
    if (await fetchLogo(provider, MOBILE_MONEY_DIR)) success++;
    total++;
  }

  console.log(`\n✨ Done! ${success}/${total} logos ready.`);
}

main();
