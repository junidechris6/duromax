require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");

// Logs path definition and safe console wrapper
const logPath = path.join(__dirname, "app.log");
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = function(...args) {
  const line = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ") + "\n";
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] [INFO] ${line}`);
  } catch (e) {}
  originalConsoleLog.apply(console, args);
};

console.error = function(...args) {
  const line = args.map(a => {
    if (a instanceof Error) {
      return a.stack || a.message;
    }
    return typeof a === "object" ? JSON.stringify(a) : String(a);
  }).join(" ") + "\n";
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] [ERROR] ${line}`);
  } catch (e) {}
  originalConsoleError.apply(console, args);
};

// Hook process.stdout and process.stderr to redirect dumpio logs
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;
process.stdout.write = function(chunk, encoding, callback) {
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] [STDOUT] ${chunk.toString()}`);
  } catch (e) {}
  return originalStdoutWrite.call(process.stdout, chunk, encoding, callback);
};
process.stderr.write = function(chunk, encoding, callback) {
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] [STDERR] ${chunk.toString()}`);
  } catch (e) {}
  return originalStderrWrite.call(process.stderr, chunk, encoding, callback);
};

// Global error handlers to prevent crashes from temporary Puppeteer/WhatsApp errors
process.on("unhandledRejection", (reason, promise) => {
  console.error("[GLOBAL WARNING] Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[GLOBAL WARNING] Uncaught Exception:", error);
});
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const XLSX = require("xlsx");
const nodemailer = require("nodemailer");

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, "duromax");
const INTERIORS_ROOT = path.join(__dirname, "duromax.framer.website");

process.env.LIBGL_ALWAYS_SOFTWARE = "1";

// Initialize WhatsApp Web client
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    // Use environment variable if provided, otherwise let Puppeteer automatically resolve
    // the Chrome binary downloaded during the package postinstall phase.
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    protocolTimeout: 300000,
    timeout: 0, // Disable navigation timeout (prevents 30s TimeoutError in slow container networks)
    dumpio: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      "--mute-audio",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gl-drawing-for-tests",
      "--disable-2d-canvas-clip-context",
      "--disable-canvas-aa",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-site-isolation-trials"
    ],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  }
});


let isWhatsappReady = false;
let latestQrCodeUrl = "";

// Waits up to `timeoutMs` for WhatsApp to become ready, polling every 2s
function waitForReady(timeoutMs = 90000) {
  if (isWhatsappReady) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const interval = setInterval(() => {
      if (isWhatsappReady) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() >= deadline) {
        clearInterval(interval);
        reject(new Error("WhatsApp client did not become ready within timeout"));
      }
    }, 2000);
  });
}

client.on("qr", qr => {
  console.log("\n==================================================");
  console.log("[ACTION REQUIRED] SCAN THIS QR CODE WITH WHATSAPP:");
  console.log("==================================================");
  console.log("If the terminal QR code is distorted, open this URL in your browser:");
  console.log(`https://quickchart.io/qr?text=${encodeURIComponent(qr)}&size=300`);
  console.log("==================================================");
  qrcode.generate(qr, { small: true });
  console.log("==================================================\n");
  latestQrCodeUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qr)}&size=300`;
});

client.on("loading_screen", (percent, message) => {
  console.log(`[INFO] WhatsApp Web Loading: ${percent}% - ${message}`);
  latestQrCodeUrl = "LOADING";
});

client.on("authenticated", () => {
  console.log("[INFO] WhatsApp Client successfully authenticated!");
  latestQrCodeUrl = "AUTHENTICATED";
});

client.on("ready", () => {
  console.log("[INFO] WhatsApp Client is ready!");
  if (client.info) {
    console.log(`[INFO] Logged in as: ${client.info.wid._serialized} (${client.info.pushname})`);
  } else {
    console.log("[INFO] Client info is not available.");
  }
  isWhatsappReady = true;
  latestQrCodeUrl = "READY";
});

client.on("change_state", state => {
  console.log("[INFO] WhatsApp Client state changed to:", state);
});

client.on("auth_failure", msg => {
  console.error("[ERROR] WhatsApp authentication failure:", msg);
});

client.on("disconnected", async reason => {
  console.warn("[WARNING] WhatsApp client disconnected. Reason:", reason);
  isWhatsappReady = false;
  try {
    console.log("[INFO] Destroying WhatsApp client to release resources...");
    await client.destroy();
  } catch (err) {
    console.error("[ERROR] Failed to destroy WhatsApp client:", err);
  }
  console.log("[INFO] Re-initializing WhatsApp client...");
  safeInitialize();
});

function deleteSingletonLock(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.lstatSync(fullPath);
        if (stat.isDirectory()) {
          // Only recurse into session folder, not into LevelDB/IndexedDB subdirs
          if (file === "session" || file === "Default") {
            deleteSingletonLock(fullPath);
          }
        } else if (
          file === "SingletonLock" ||
          file === "SingletonCookie" ||
          file === "SingletonSocket"
          // NOTE: Do NOT delete "LOCK" files — those are LevelDB internal locks
          // and deleting them corrupts the database. pkill handles releasing them.
        ) {
          fs.unlinkSync(fullPath);
          console.log(`[INFO] Deleted leftover lock file: ${fullPath}`);
        }
      } catch (err) {
        console.warn(`[WARNING] Error handling lock file ${fullPath}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error("[ERROR] Failed to read auth directory for locks:", err.message);
  }
}

function cleanUpCachesAndLogs() {
  const sessionDir = path.join(__dirname, ".wwebjs_auth", "session");
  const logFile = path.join(__dirname, "app.log");

  console.log("[CLEANUP] Starting cache and log cleanup to free space...");

  // 1. Truncate app.log if it is too large (> 10MB)
  try {
    if (fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      if (stats.size > 10 * 1024 * 1024) {
        fs.writeFileSync(logFile, `[${new Date().toISOString()}] [INFO] Log truncated due to size limit.\n`);
        console.log("[CLEANUP] Truncated large app.log file.");
      }
    }
  } catch (err) {
    console.warn("[CLEANUP WARNING] Failed to handle log truncation:", err.message);
  }

  if (!fs.existsSync(sessionDir)) return;

  // 2. Safely remove non-essential Puppeteer cache files (preserving session databases/cookies)
  const pathsToClean = [
    path.join(sessionDir, "Crashpad"),
    path.join(sessionDir, "Default", "Cache"),
    path.join(sessionDir, "Default", "Code Cache"),
    path.join(sessionDir, "Default", "GPUCache"),
    path.join(sessionDir, "Default", "Service Worker", "CacheStorage"),
    path.join(sessionDir, "Default", "Service Worker", "ScriptCache"),
    path.join(sessionDir, "Default", "DawnGraphiteCache"),
    path.join(sessionDir, "Default", "DawnWebGPUCache"),
  ];

  for (const dirPath of pathsToClean) {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        console.log(`[CLEANUP] Deleted cache directory to free space: ${dirPath}`);
      }
    } catch (err) {
      console.warn(`[CLEANUP WARNING] Failed to delete ${dirPath}:`, err.message);
    }
  }

  // 3. Delete any large metric/temp files in the root session directory
  try {
    const files = fs.readdirSync(sessionDir);
    for (const file of files) {
      if (file.endsWith(".pma") || file.endsWith(".tmp")) {
        const fullPath = path.join(sessionDir, file);
        fs.unlinkSync(fullPath);
        console.log(`[CLEANUP] Deleted temporary file: ${fullPath}`);
      }
    }
  } catch (err) {
    console.warn("[CLEANUP WARNING] Failed to read session directory for temp files:", err.message);
  }
}

async function safeInitialize() {
  const authDir = path.join(__dirname, ".wwebjs_auth");
  deleteSingletonLock(authDir);

  try {
    console.log("[INFO] Initializing WhatsApp Client...");
    await client.initialize();
  } catch (err) {
    console.error("[ERROR] Failed to initialize WhatsApp Client. Retrying in 10 seconds...", err);
    try {
      console.log("[INFO] Destroying WhatsApp client to release resources and locks...");
      await client.destroy();
    } catch (destroyErr) {
      console.warn("[WARNING] Failed to destroy client on retry:", destroyErr.message);
    }
    setTimeout(safeInitialize, 10000);
  }
}

// Clear caches and logs first to free disk space on start
cleanUpCachesAndLogs();
safeInitialize();

let isWorkaroundRunning = false;
setInterval(async () => {
  if (client.pupPage && !client.consoleListenersAttached) {
    client.consoleListenersAttached = true;
    console.log("[INFO] Early Puppeteer page hook attached.");
    client.pupPage.on("console", msg => {
      console.log(`[BROWSER CONSOLE] ${msg.text()}`);
    });
    client.pupPage.on("pageerror", err => {
      console.error(`[BROWSER PAGE ERROR]`, err);
    });
    client.pupPage.on("error", async err => {
      console.error(`[BROWSER ERROR]`, err);
      if (err && err.message && err.message.includes("crashed")) {
        console.error("[FATAL] WhatsApp Web browser page crashed! Triggering auto-recovery...");
        isWhatsappReady = false;
        try {
          await client.destroy();
        } catch (destroyErr) {
          console.warn("[WARNING] Failed to destroy client during crash recovery:", destroyErr.message);
        }
        try {
          const { execSync } = require("child_process");
          execSync("pkill -f chromium || pkill -f chrome || true", { stdio: "ignore" });
        } catch (pkillErr) { /* ignore */ }
        const authDir = path.join(__dirname, ".wwebjs_auth");
        deleteSingletonLock(authDir);
        setTimeout(safeInitialize, 5000);
      }
    });
  }

  if (!isWhatsappReady && client.pupPage && !isWorkaroundRunning) {
    isWorkaroundRunning = true;
    try {
      const isLoaded = await Promise.race([
        client.pupPage.evaluate(() => {
          return typeof window.WWebJS !== "undefined" && !!(document.querySelector('#pane-side') || document.querySelector('div[role="navigation"]') || document.querySelector('div[contenteditable="true"]'));
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Workaround evaluate timeout")), 3000))
      ]);
      if (isLoaded) {
        console.log("[WORKAROUND] Detected WhatsApp Web chats list is loaded and injected! Forcing isWhatsappReady = true.");
        isWhatsappReady = true;
        latestQrCodeUrl = "READY";
      }
    } catch (e) {
      // Ignored
    } finally {
      isWorkaroundRunning = false;
    }
  }
}, 5000);

let consecutivePingFailures = 0;
setInterval(async () => {
  if (isWhatsappReady && client.pupPage) {
    try {
      await Promise.race([
        client.pupPage.evaluate(() => {
          return typeof window.WWebJS !== "undefined";
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Keep-alive ping timeout")), 8000))
      ]);
      consecutivePingFailures = 0;
    } catch (e) {
      console.warn("[WARNING] Keep-alive ping failed:", e.message);
      consecutivePingFailures++;
      if (consecutivePingFailures >= 5) {
        console.error("[ERROR] Keep-alive ping failed 5 times consecutively. Restarting WhatsApp client.");
        isWhatsappReady = false;
        consecutivePingFailures = 0;
        try {
          console.log("[INFO] Attempting to re-initialize WhatsApp client...");
          await client.destroy();
          isWhatsappReady = false;
          safeInitialize();
        } catch (destroyErr) {
          console.error("[ERROR] Failed to destroy client during recovery:", destroyErr.message);
        }
      }
    }
  }
}, 120000); // Ping every 2 minutes to reduce browser load

// Wraps sendMessage with a hard timeout — if it hangs (never resolves), treat as failure
function sendMessageWithTimeout(to, content, options = {}, timeoutMs = 45000) {
  return Promise.race([
    client.sendMessage(to, content, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`sendMessage timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

// Sends a WhatsApp message with a timeout, retrying once after a forced clean restart if it hangs
async function sendMessageWithRetry(to, content, options = {}) {
  try {
    return await sendMessageWithTimeout(to, content, options, 45000);
  } catch (err) {
    console.warn(`[WARNING] sendMessage failed or timed out: ${err.message}. Force-restarting WhatsApp...`);
    isWhatsappReady = false;
    // Step 1: Destroy client gracefully
    try { await client.destroy(); } catch (e) { /* ignore */ }
    // Step 2: Kill any lingering Chrome/Chromium processes
    try {
      const { execSync } = require("child_process");
      execSync("pkill -f chromium || pkill -f chrome || true", { stdio: "ignore" });
      console.log("[INFO] Killed lingering Chrome processes.");
    } catch (e) { /* ignore */ }
    // Step 3: Remove all lock files so the new browser can start cleanly
    const authDir = path.join(__dirname, ".wwebjs_auth");
    deleteSingletonLock(authDir);
    // Step 4: Wait briefly for processes to die
    await new Promise(r => setTimeout(r, 3000));
    // Step 5: Reinitialize
    safeInitialize();
    await waitForReady(120000);
    console.log("[INFO] WhatsApp restarted. Retrying message send...");
    return await sendMessageWithTimeout(to, content, options, 45000);
  }
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".pdf": "application/pdf",
  ".xml": "application/xml; charset=utf-8",
  ".rss": "application/rss+xml; charset=utf-8"
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 8 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function normalizeIndiaPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits;
  }
  return "";
}

async function handleSendCouponVoucher(req, res) {
  console.log("[API REQUEST] Received request on /api/send-coupon-voucher");
  try {
    const payload = await readJsonBody(req);
    const to = normalizeIndiaPhone(payload.phone);
    const code = String(payload.code || "").trim();
    const clientName = String(payload.clientName || "").trim();
    const consultantName = String(payload.consultantName || "").trim();
    const consultantId = String(payload.consultantId || "").trim();
    console.log(`[INFO] Client phone: ${payload.phone} (normalized: ${to}), coupon code: ${code}, client: ${clientName}`);

    if (!to || !code) {
      console.error("[ERROR] Missing or invalid client phone number or coupon code in request payload.");
      sendJson(res, 400, { ok: false, error: "Missing valid phone or coupon code." });
      return;
    }

    let whatsappSent = false;
    let whatsappResultId = null;

    if (!payload.imageDataUrl || !payload.imageDataUrl.startsWith("data:image/png;base64,")) {
      console.error("[ERROR] Invalid coupon image format.");
      sendJson(res, 400, { ok: false, error: "Invalid coupon image data." });
      return;
    }

    try {
      console.log("[INFO] Waiting for WhatsApp to be ready before sending coupon...");
      await waitForReady(5000);
    } catch (waitErr) {
      console.warn("[WARNING] WhatsApp not ready in time for coupon send:", waitErr.message);
    }

    if (isWhatsappReady) {
      const base64Data = payload.imageDataUrl.replace(/^data:image\/png;base64,/, "").replace(/\s/g, "");
      const media = new MessageMedia("image/png", base64Data, `${code}.png`);
      const whatsappId = `${to}@c.us`;

      const caption = `Dear ${clientName || "Customer"},\n\n` +
                      `As a valued prospective client of Duromax Construction & Interiors, you have been granted access to an exclusive *10% Private Client Privilege.*\n\n` +
                      `📄 Your voucher is attached.\n\n` +
                      `🔖 Voucher Code: ${code}\n\n` +
                      `This privilege is extended only to a select few and may be redeemed towards your upcoming project with us.\n\n` +
                      `At Duromax Construction & Interiors, we create bespoke residences designed around your vision, lifestyle and legacy.\n\n` +
                      `We look forward to assisting you in bringing your dream home to life.\n\n` +
                      `Warm regards,\n` +
                      `Duromax Construction & Interiors`;

      console.log(`[INFO] Sending coupon image to ${whatsappId}...`);
      const result = await sendMessageWithRetry(whatsappId, media, { 
        caption: caption
      });
      whatsappResultId = result && result.id ? result.id._serialized : "sent-successfully";
      whatsappSent = true;
      console.log(`[SUCCESS] Coupon sent successfully to ${to}!`);
    } else {
      console.warn("[WARNING] WhatsApp client still not ready after wait. Skipping coupon send.");
    }

    sendJson(res, 200, { ok: true, whatsappSent: whatsappSent, result: { id: whatsappResultId || "local-only" } });
  } catch (error) {
    console.error("[EXC] Exception in handleSendCouponVoucher:", error);
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

function appendLeadToExcel(leadRow) {
  const authDir = path.join(__dirname, ".wwebjs_auth");
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }
  const filePath = path.join(authDir, "durointerior_coupen.xlsx");
  let workbook;
  let worksheet;
  let data = [];

  try {
    if (fs.existsSync(filePath)) {
      workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      worksheet = workbook.Sheets[sheetName];
      data = XLSX.utils.sheet_to_json(worksheet);
    } else {
      workbook = XLSX.utils.book_new();
    }

    data.push(leadRow);

    worksheet = XLSX.utils.json_to_sheet(data);

    // Auto-adjust column widths
    const maxCols = Object.keys(leadRow).length || 10;
    worksheet["!cols"] = Array(maxCols).fill({ wch: 22 });

    if (workbook.SheetNames.length === 0) {
      XLSX.utils.book_append_sheet(workbook, worksheet, "durointerior coupen");
    } else {
      workbook.Sheets[workbook.SheetNames[0]] = worksheet;
    }

    XLSX.writeFile(workbook, filePath);
    console.log(`[SUCCESS] Lead details appended to Excel file locally: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error("[ERROR] Failed to save lead to Excel:", error);
    return null;
  }
}

async function sendExcelEmail(excelFilePath, leadRow) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;

  if (resendApiKey) {
    console.log(`[EMAIL] Attempting to send leads spreadsheet via Resend API to duromaxofficial@gmail.com...`);
    try {
      const fs = require('fs');
      const shouldAttach = !process.env.GOOGLE_SHEET_WEBHOOK_URL && excelFilePath && fs.existsSync(excelFilePath);
      const base64Content = shouldAttach ? fs.readFileSync(excelFilePath).toString("base64") : "";

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: "Duro-Max Leads <onboarding@resend.dev>",
          to: "duromaxofficial@gmail.com",
          subject: `📋 New Duro-Max Lead Submission - Code: ${leadRow["Coupon Code"] || "N/A"}`,
          html: `
            <p>Hello,</p>
            <p>A new lead form has been submitted on the Duro-Max website.</p>
            <p><strong>Details:</strong></p>
            <ul>
              <li><strong>Timestamp:</strong> ${leadRow["Timestamp"]}</li>
              <li><strong>Coupon Code:</strong> ${leadRow["Coupon Code"]}</li>
              <li><strong>Client Name:</strong> ${leadRow["Client Name"] || "N/A"}</li>
              <li><strong>Designation:</strong> ${leadRow["Designation"] || "N/A"}</li>
              <li><strong>Consultant Name:</strong> ${leadRow["Consultant Name"] || "N/A"}</li>
              <li><strong>Consultant ID:</strong> ${leadRow["Consultant ID"] || "N/A"}</li>
              <li><strong>Consultant Phone:</strong> ${leadRow["Consultant Phone"] || "N/A"}</li>
            </ul>
            ${process.env.GOOGLE_SHEET_WEBHOOK_URL 
              ? `<p>The details have been added to your live Google Sheet.</p>` 
              : (shouldAttach 
                  ? `<p>The updated full leads database (Excel spreadsheet) has been attached to this email.</p>`
                  : `<p>Note: Google Sheet webhook is not configured and local spreadsheet could not be attached.</p>`)}
            <br>
            <p>Best regards,<br>Duro-Max Automated Lead System</p>
          `,
          attachments: shouldAttach ? [
            {
              filename: "durointerior coupen.xlsx",
              content: base64Content
            }
          ] : []
        })
      });

      const result = await response.json();
      if (response.ok) {
        console.log(`[SUCCESS] Leads spreadsheet emailed via Resend: ${result.id}`);
        return true;
      } else {
        console.warn("[WARNING] Resend API returned error:", result, ". Falling back to SMTP...");
      }
    } catch (resendError) {
      console.warn("[WARNING] Failed to send email via Resend:", resendError, ". Falling back to SMTP...");
    }
  }

  if (!emailUser || !emailPass || emailUser === "your-email@gmail.com" || emailPass === "your-gmail-app-password") {
    console.warn("[WARNING] Email credentials not configured. Skipping email delivery.");
    return false;
  }

  console.log(`[EMAIL] Attempting to send leads spreadsheet to duromaxofficial@gmail.com...`);
  
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true, // Use SSL
      auth: {
        user: emailUser,
        pass: emailPass
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
      family: 4, // Force IPv4 to bypass Railway container IPv6 connection hangs
      tls: {
        rejectUnauthorized: false // Prevent certificate issues
      }
    });

    const mailOptions = {
      from: `"Duro-Max Leads" <${emailUser}>`,
      to: "duromaxofficial@gmail.com",
      subject: `📋 New Duro-Max Lead Submission - Code: ${leadRow["Coupon Code"] || "N/A"}`,
      text: `Hello,

A new lead form has been submitted on the Duro-Max website.

Details:
--------------------------------------
Timestamp: ${leadRow["Timestamp"]}
Coupon Code: ${leadRow["Coupon Code"]}
Client Name: ${leadRow["Client Name"] || "N/A"}
Designation: ${leadRow["Designation"] || "N/A"}
Consultant Name: ${leadRow["Consultant Name"] || "N/A"}
Consultant ID: ${leadRow["Consultant ID"] || "N/A"}
Consultant Phone: ${leadRow["Consultant Phone"] || "N/A"}
--------------------------------------

${process.env.GOOGLE_SHEET_WEBHOOK_URL
  ? "The details have been added to your live Google Sheet."
  : "The updated full leads database (Excel spreadsheet) has been attached to this email."}

Best regards,
Duro-Max Automated Lead System`,
      attachments: (process.env.GOOGLE_SHEET_WEBHOOK_URL || !excelFilePath) ? [] : [
        {
          filename: "durointerior coupen.xlsx",
          path: excelFilePath
        }
      ]
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[SUCCESS] Lead email notification sent to duromaxofficial@gmail.com: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error("[ERROR] Failed to send email via SMTP:", error);
    return false;
  }
}

async function sendToGoogleSheet(payload) {
  const webhookUrl = process.env.GOOGLE_SHEET_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[WARNING] GOOGLE_SHEET_WEBHOOK_URL not configured. Skipping Google Sheets integration.");
    return false;
  }

  console.log(`[GOOGLE SHEETS] Attempting to send lead to Google Sheets...`);
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        couponCode: payload.couponCode || "N/A",
        consultantPhone: payload.consultantPhone || "N/A",
        entries: payload.entries || [],
        fileAttachment: payload.fileAttachment || null
      })
    });

    const result = await response.json();
    if (response.ok && result.status === "success") {
      console.log(`[SUCCESS] Lead successfully sent to Google Sheets!`);
      return true;
    } else {
      console.error(`[ERROR] Google Sheets webhook returned error:`, result);
      return false;
    }
  } catch (error) {
    console.error(`[ERROR] Failed to send lead to Google Sheets:`, error);
    return false;
  }
}

async function handleSendFormToConsultant(req, res) {
  console.log("[API REQUEST] Received request on /api/send-form-to-consultant");
  try {
    const payload = await readJsonBody(req);
    const consultantPhone = normalizeIndiaPhone(payload.consultantPhone);
    const couponCode = String(payload.couponCode || "").trim();
    const entries = payload.entries || [];
    console.log(`[INFO] Consultant phone: ${payload.consultantPhone} (normalized: ${consultantPhone}), coupon code: ${couponCode}`);

    // 1. Build row data for Excel
    const leadRow = {
      "Timestamp": new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      "Coupon Code": couponCode || "N/A",
      "Consultant Phone": consultantPhone || "N/A"
    };

    entries.forEach(entry => {
      const label = String(entry.label || "").trim();
      const value = String(entry.value || "").trim();
      if (label) {
        leadRow[label] = value;
      }
    });

    if (payload.fileAttachment && payload.fileAttachment.name) {
      leadRow["Attached Floor Plan"] = payload.fileAttachment.name;
    } else {
      leadRow["Attached Floor Plan"] = "None";
    }

    // 2. Append to Excel file
    const excelFilePath = appendLeadToExcel(leadRow);

    // 3. Send email to duromaxofficial@gmail.com asynchronously
    sendExcelEmail(excelFilePath, leadRow).catch(err => {
      console.error("[ERROR] Async email send error:", err);
    });

    // 4. Send to Google Sheets Webhook asynchronously
    sendToGoogleSheet(payload).catch(err => {
      console.error("[ERROR] Async Google Sheets send error:", err);
    });

    // 5. Send WhatsApp message in the background (completely decoupled)
    if (consultantPhone) {
      (async () => {
        try {
          console.log("[INFO] Waiting for WhatsApp to be ready before sending consultant form in background...");
          await waitForReady(90000); // Wait up to 90 seconds in the background for WhatsApp to recover/restart
          
          if (isWhatsappReady) {
            const whatsappId = `${consultantPhone}@c.us`;

            // Extract client name and phone
            const clientNameEntry = entries.find(e => /client\s*name/i.test(e.label || ""));
            const clientName = clientNameEntry ? String(clientNameEntry.value).trim() : "N/A";

            const clientPhoneEntry = entries.find(e => /primary\s*contact/i.test(e.label || ""));
            const clientPhone = clientPhoneEntry ? String(clientPhoneEntry.value).trim() : "N/A";

            const caption = `A new prospect has been awarded a 10% Private Client Privilege and added to the Duromax lead portfolio.\n\n` +
                            `🔖 *Voucher Code:* ${couponCode}\n` +
                            `👤 *Client:* ${clientName}\n` +
                            `📞 *Contact:* ${clientPhone}\n\n` +
                            `📄 Voucher attached for reference.\n\n` +
                            `Thank you for contributing to the growth of the Duromax network. The client has been handed over to the sales team for further engagement.\n\n` +
                            `Regards\n` +
                            `Duromax Constructions & Interiors`;

            let whatsappResultId = null;
            let whatsappSent = false;

            if (payload.imageDataUrl && payload.imageDataUrl.startsWith("data:image/png;base64,")) {
              const base64Image = payload.imageDataUrl.replace(/^data:image\/png;base64,/, "").replace(/\s/g, "");
              const couponMedia = new MessageMedia("image/png", base64Image, `${couponCode || "coupon"}.png`);
              
              console.log(`[INFO] Sending coupon image and caption to consultant ${whatsappId}...`);
              const result = await sendMessageWithRetry(whatsappId, couponMedia, { 
                caption: caption
              });
              whatsappResultId = result && result.id ? result.id._serialized : "sent-successfully";
              whatsappSent = true;
              console.log(`[SUCCESS] Coupon image and details sent to consultant ${consultantPhone}!`);
            } else {
              // Fallback to text message if image is not provided
              console.warn("[WARNING] No coupon image provided. Sending text message fallback to consultant.");
              const result = await sendMessageWithRetry(whatsappId, caption + `\n🎫 *Coupon Code:* ${couponCode || "N/A"}`);
              whatsappResultId = result && result.id ? result.id._serialized : "sent-successfully";
              whatsappSent = true;
            }

            // If there is an attached file, send it to the consultant as media
            if (payload.fileAttachment && payload.fileAttachment.base64) {
              try {
                const file = payload.fileAttachment;
                const rawBase64 = file.base64.includes(",") ? file.base64.split(",")[1] : file.base64;
                const base64Data = rawBase64.replace(/\s/g, "");
                // Validate base64 string before sending
                if (base64Data && /^[A-Za-z0-9+/]+=*$/.test(base64Data)) {
                  console.log(`[INFO] Sending attached file "${file.name}" (${file.type}) to consultant...`);
                  const media = new MessageMedia(file.type, base64Data, file.name);
                  await sendMessageWithRetry(whatsappId, media, {
                    caption: `📎 Attached Floor Plan: ${file.name}`
                  });
                  console.log(`[SUCCESS] Attached file "${file.name}" sent to consultant successfully!`);
                } else {
                  console.warn(`[WARNING] File attachment "${file.name}" has invalid base64 data — skipping.`);
                }
              } catch (mediaError) {
                console.error("[ERROR] Failed to send file attachment via WhatsApp:", mediaError);
              }
            }
          } else {
            console.warn("[WARNING] WhatsApp client is not ready. Skipping sending WhatsApp message.");
          }
        } catch (bgError) {
          console.error("[ERROR] Exception in background WhatsApp sending:", bgError);
        }
      })();
    }

    sendJson(res, 200, { ok: true, whatsappSent: true, result: { id: "processed" } });
  } catch (error) {
    console.error("[EXC] Exception in handleSendFormToConsultant:", error);
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

function serveStatic(req, res) {
  const rawPath = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
  let staticRoot = ROOT;
  let cleanPath = rawPath;

  if (
    rawPath === "/interiorsprivateprivilege" || 
    rawPath === "/interiorsprivateprivilege/" || 
    rawPath === "/interiorsprivateprivilege/index.html"
  ) {
    staticRoot = INTERIORS_ROOT;
    cleanPath = "/index.html";
  } else if (rawPath.startsWith("/interiorsprivateprivilege/")) {
    staticRoot = INTERIORS_ROOT;
    cleanPath = rawPath.substring("/interiorsprivateprivilege".length);
  } else if (rawPath.startsWith("/framerusercontent.com/")) {
    staticRoot = __dirname;
    cleanPath = rawPath;
  }

  let filePath = path.normalize(path.join(staticRoot, cleanPath));

  if (!filePath.startsWith(staticRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const tryServeFile = (targetFile) => {
    fs.readFile(targetFile, (error, data) => {
      if (error) {
        const custom404 = path.join(ROOT, "404", "index.html");
        fs.readFile(custom404, (err404, data404) => {
          if (!err404) {
            res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
            res.end(data404);
          } else {
            res.writeHead(404);
            res.end("Not Found");
          }
        });
        return;
      }
      const ext = path.extname(targetFile).toLowerCase();
      const headers = {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream"
      };
      if (ext === ".html") {
        headers["Cache-Control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
        headers["Pragma"] = "no-cache";
        headers["Expires"] = "0";
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  };

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isDirectory()) {
      filePath = path.join(filePath, "index.html");
      tryServeFile(filePath);
    } else if (!err && stats.isFile()) {
      tryServeFile(filePath);
    } else {
      const indexPath = path.join(filePath, "index.html");
      fs.stat(indexPath, (errIndex, statsIndex) => {
        if (!errIndex && statsIndex.isFile()) {
          tryServeFile(indexPath);
        } else {
          const htmlPath = filePath + ".html";
          fs.stat(htmlPath, (errHtml, statsHtml) => {
            if (!errHtml && statsHtml.isFile()) {
              tryServeFile(htmlPath);
            } else {
              tryServeFile(filePath);
            }
          });
        }
      });
    }
  });
}

const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);

  // CORS headers for API endpoints
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  // Health check endpoint — responds instantly so Railway knows the server is alive.
  // This MUST respond before WhatsApp/Chromium finishes initializing.
  if (req.method === "GET" && (pathname === "/health" || pathname === "/healthz")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", whatsapp: isWhatsappReady }));
    return;
  }

  if (req.method === "POST" && pathname === "/api/send-test-text") {
    try {
      const payload = await readJsonBody(req);
      const to = normalizeIndiaPhone(payload.phone);
      if (isWhatsappReady) {
        console.log(`[INFO] Sending test text message to ${to}...`);
        await client.sendMessage(`${to}@c.us`, "This is a test text message from Duro-Max Railway Server!");
        console.log(`[SUCCESS] Test text message sent successfully to ${to}`);
        sendJson(res, 200, { ok: true, msg: "Text sent successfully." });
      } else {
        console.warn("[WARNING] WhatsApp client not ready for text message.");
        sendJson(res, 400, { ok: false, msg: "WhatsApp not ready." });
      }
    } catch (err) {
      console.error("[ERROR] Exception in send-test-text:", err.message);
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }



  if (req.method === "POST" && pathname === "/api/send-coupon-voucher") {
    handleSendCouponVoucher(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/send-form-to-consultant") {
    handleSendFormToConsultant(req, res);
    return;
  }

  if ((req.method === "POST" || req.method === "GET") && pathname === "/api/wa-logout") {
    console.log("[INFO] Received request to log out WhatsApp client...");
    try {
      if (isWhatsappReady) {
        try {
          await client.logout();
          console.log("[SUCCESS] WhatsApp client successfully logged out via API!");
        } catch (e) {
          console.warn("[WARNING] client.logout failed, proceeding with manual cleanup:", e.message);
        }
      }
      
      // Destroy the client to close Puppeteer/Chromium and release file locks
      try {
        console.log("[INFO] Destroying WhatsApp client to release file locks...");
        await client.destroy();
      } catch (e) {
        console.warn("[WARNING] client.destroy failed during logout:", e.message);
      }
      
      isWhatsappReady = false;
      
      // Manually delete session directory contents (to avoid EBUSY if the directory itself is a mount point)
      const authDir = path.join(__dirname, ".wwebjs_auth");
      if (fs.existsSync(authDir)) {
        try {
          const files = fs.readdirSync(authDir);
          for (const file of files) {
            const fullPath = path.join(authDir, file);
            fs.rmSync(fullPath, { recursive: true, force: true });
          }
          console.log("[SUCCESS] Wiped all session files in auth directory:", authDir);
        } catch (rmErr) {
          console.error("[ERROR] Failed to wipe session files:", rmErr.message);
        }
      }
      
      sendJson(res, 200, { ok: true, msg: "Logged out and clearing session. Server will restart in a few seconds..." });
      
      // Exit process to let container manager (Railway) reboot the server cleanly
      setTimeout(() => {
        console.log("[INFO] Exiting process for clean container restart...");
        process.exit(0);
      }, 1000);
      
    } catch (err) {
      console.error("[ERROR] Exception in /api/wa-logout:", err);
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/wa-pair") {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const phone = parsedUrl.searchParams.get("phone");
    if (!phone) {
      sendJson(res, 400, { ok: false, error: "Missing 'phone' query parameter." });
      return;
    }
    const cleanPhone = phone.replace(/\D/g, "");
    if (!cleanPhone) {
      sendJson(res, 400, { ok: false, error: "Invalid phone number." });
      return;
    }
    console.log(`[INFO] Requesting pairing code for phone number: ${cleanPhone}`);
    try {
      const code = await client.requestPairingCode(cleanPhone);
      console.log(`[SUCCESS] Generated pairing code: ${code}`);
      sendJson(res, 200, { ok: true, code });
    } catch (err) {
      console.error("[ERROR] Failed to request pairing code:", err);
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/wa-restart") {
    console.log("[INFO] Received request to restart server process...");
    sendJson(res, 200, { ok: true, msg: "Restarting server process. Please wait a few seconds..." });
    setTimeout(() => {
      console.log("[INFO] Exiting process for container reboot...");
      process.exit(0);
    }, 1000);
    return;
  }

  if (req.method === "GET" && pathname === "/api/wa-screenshot") {
    if (client.pupPage) {
      try {
        const screenshot = await client.pupPage.screenshot({ type: "png" });
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(screenshot);
      } catch (err) {
        res.writeHead(500);
        res.end("Failed to capture screenshot: " + err.message);
      }
    } else {
      res.writeHead(400);
      res.end("WhatsApp client page is not initialized yet.");
    }
    return;
  }

  if (req.method === "GET" && pathname === "/wa-qr") {
    const qrUrl = latestQrCodeUrl && latestQrCodeUrl !== "LOADING" && latestQrCodeUrl !== "READY"
      ? latestQrCodeUrl : null;
    const statusText = isWhatsappReady
      ? "✅ WhatsApp is already connected! No need to scan."
      : (qrUrl ? "📱 Scan this QR code with WhatsApp on the Duromax phone." : "⏳ Loading QR code... Please wait and refresh.");
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Duromax WhatsApp QR Login</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #0f1923; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1a2535; border-radius: 20px; padding: 40px; text-align: center; max-width: 420px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
    .logo { font-size: 28px; font-weight: 700; color: #25d366; margin-bottom: 8px; }
    .sub { color: #8899aa; font-size: 14px; margin-bottom: 30px; }
    .status { font-size: 15px; margin-bottom: 20px; padding: 12px 20px; border-radius: 10px; background: #25272d; }
    .qr-box { background: #fff; border-radius: 16px; padding: 20px; display: inline-block; margin: 10px 0 20px; }
    .qr-box img { width: 240px; height: 240px; display: block; }
    .no-qr { color: #aaa; font-size: 14px; margin: 20px 0; }
    .refresh { color: #25d366; font-size: 13px; margin-top: 10px; }
    .steps { text-align: left; background: #25272d; border-radius: 12px; padding: 16px 20px; margin-top: 20px; font-size: 14px; line-height: 1.8; color: #cdd; }
    .steps b { color: #25d366; }
    .countdown { font-size: 13px; color: #556; margin-top: 10px; }
  </style>
  <script>
    let secs = 15;
    function tick() {
      secs--;
      const el = document.getElementById('cd');
      if (el) el.textContent = 'Refreshing in ' + secs + 's...';
      if (secs <= 0) { location.reload(); } else { setTimeout(tick, 1000); }
    }
    window.onload = tick;
  </script>
</head>
<body>
  <div class="card">
    <div class="logo">Duromax WhatsApp Login</div>
    <div class="sub">Scan once to connect the Duromax business WhatsApp</div>
    <div class="status">${statusText}</div>
    ${qrUrl && !isWhatsappReady ? `<div class="qr-box"><img src="${qrUrl}" alt="QR Code"/></div>` : ''}
    ${!qrUrl && !isWhatsappReady ? `<div class="no-qr">⏳ QR not ready yet. Page will auto-refresh...</div>` : ''}
    <div class="countdown" id="cd">Refreshing in 15s...</div>
    ${!isWhatsappReady ? `<div class="steps">
      <b>Steps:</b><br>
      1. Open WhatsApp on the Duromax phone<br>
      2. Tap ⋮ → <b>Linked Devices</b><br>
      3. Tap <b>Link a Device</b><br>
      4. Scan the QR code above
    </div>` : ''}
  </div>
</body>
</html>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "GET" && pathname === "/api/wa-debug") {

    let debugInfo = {
      isWhatsappReady: isWhatsappReady,
      latestQrCodeUrl: latestQrCodeUrl,
      hasPage: !!client.pupPage,
      pageUrl: null,
      domInfo: null,
      authDirFiles: [],
      envConfig: {
        hasResendApiKey: !!process.env.RESEND_API_KEY,
        hasEmailUser: !!process.env.EMAIL_USER,
        hasEmailPass: !!process.env.EMAIL_PASS,
        hasGoogleSheetWebhook: !!process.env.GOOGLE_SHEET_WEBHOOK_URL
      }
    };

    // Check files in authDir
    const authDir = path.join(__dirname, ".wwebjs_auth");
    if (fs.existsSync(authDir)) {
      try {
        const getFiles = (dir) => {
          let results = [];
          const list = fs.readdirSync(dir);
          list.forEach(file => {
            const filePath = path.join(dir, file);
            const stat = fs.lstatSync(filePath);
            if (stat.isDirectory()) {
              results.push({ name: file, type: "dir" });
            } else {
              results.push({ name: file, type: "file", size: stat.size });
            }
          });
          return results;
        };
        debugInfo.authDirFiles = getFiles(authDir);
      } catch (err) {
        debugInfo.authDirError = err.message;
      }
    }

    if (client.pupPage) {
      try {
        debugInfo.pageUrl = client.pupPage.url();
      } catch (err) {
        debugInfo.wwebjsError = err.message;
      }
    }
    sendJson(res, 200, debugInfo);
    return;
  }

  if (req.method === "GET" && pathname === "/api/test-launch") {
    res.writeHead(200, { "Content-Type": "application/json" });
    try {
      const puppeteer = require("puppeteer");
      console.log("[DEBUG] Starting test launch of Puppeteer...");
      const browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage"
        ]
      });
      const version = await browser.version();
      await browser.close();
      res.end(JSON.stringify({ ok: true, version }));
    } catch (err) {
      res.end(JSON.stringify({ ok: false, error: err.message, stack: err.stack }));
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/wa-logs") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    if (fs.existsSync(logPath)) {
      const logs = fs.readFileSync(logPath, "utf-8");
      res.end(logs);
    } else {
      res.end("No logs found.");
    }
    return;
  }

  if (req.method === "GET" && pathname === "/qr") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    let content = "";
    if (latestQrCodeUrl === "READY") {
      content = `<h3>✅ WhatsApp is connected and ready!</h3><p>Your local automated server is fully linked to WhatsApp.</p>`;
    } else if (latestQrCodeUrl === "LOADING" || latestQrCodeUrl === "AUTHENTICATED") {
      content = `<h3>⏳ Synchronizing chats...</h3><p>WhatsApp Client successfully authenticated! Please wait while it synchronizes messages.</p>`;
    } else if (latestQrCodeUrl) {
      content = `
        <p>Scan the QR code below using your phone's WhatsApp: Tap Link a Device.</p>
        <img src="${latestQrCodeUrl}" alt="WhatsApp QR Code" />
      `;
    } else {
      content = `<h3>⏳ Initializing WhatsApp Web...</h3><p>Please wait a few seconds for the client to start up.</p>`;
    }
    
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>WhatsApp Web Link Device</title>
        <meta http-equiv="refresh" content="5">
        <style>
          body {
            background: #111b21;
            color: #e9edef;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
          }
          .container {
            background: #222e35;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            text-align: center;
            max-width: 400px;
            width: 90%;
          }
          h2 {
            margin-top: 0;
            color: #00a884; /* WhatsApp Green */
          }
          img {
            border: 8px solid #fff;
            border-radius: 6px;
            margin: 20px 0;
            width: 250px;
            height: 250px;
          }
          p {
            font-size: 14px;
            line-height: 1.4;
            color: #8696a0;
          }
          .loader {
            border: 4px solid rgba(255,255,255,0.1);
            border-top: 4px solid #00a884;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>WhatsApp Link Device</h2>
          ${latestQrCodeUrl === "READY" ? "" : (latestQrCodeUrl === "LOADING" || latestQrCodeUrl === "AUTHENTICATED" || !latestQrCodeUrl ? '<div class="loader"></div>' : '')}
          ${content}
          
          ${latestQrCodeUrl !== "READY" ? `
            <div style="margin-top: 20px; border-top: 1px solid #3b4a54; padding-top: 20px;">
              <h3 style="margin-top: 0; font-size: 15px; color: #e9edef;">Or Link via Phone Number (No Scan)</h3>
              <input type="text" id="phoneInput" placeholder="e.g. 919345900571" style="width: 90%; padding: 10px; background: #2a3942; border: 1px solid #3b4a54; border-radius: 6px; color: white; margin-bottom: 10px; text-align: center; font-size: 14px;" />
              <button id="pairBtn" style="padding: 10px; background: #00a884; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 14px; width: 100%; transition: background 0.2s;">Get Pairing Code</button>
              <div id="pairingCodeContainer" style="margin-top: 15px; display: none;">
                <p style="margin: 5px 0; font-size: 12px; color: #8696a0;">Enter this code on your phone:</p>
                <div id="pairingCodeDisplay" style="font-size: 24px; font-weight: bold; color: #00a884; letter-spacing: 4px; padding: 10px; background: #111b21; border-radius: 6px; display: inline-block;"></div>
              </div>
            </div>
          ` : ''}

          <button id="logoutBtn" style="margin-top: 20px; padding: 10.5px 20px; background: #ef4444; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 14px; width: 100%; transition: background 0.2s;">Disconnect / Change Number</button>
          
          <p style="font-size: 11px; margin-top: 25px; opacity: 0.5;">This page auto-refreshes every 5 seconds.</p>
        </div>

        <script>
          const pairBtn = document.getElementById('pairBtn');
          if (pairBtn) {
            pairBtn.addEventListener('click', function() {
              const phone = document.getElementById('phoneInput').value.trim();
              if (!phone) {
                alert('Please enter a phone number first!');
                return;
              }
              pairBtn.disabled = true;
              pairBtn.textContent = 'Generating code...';
              fetch('/api/wa-pair?phone=' + encodeURIComponent(phone))
                .then(r => r.json())
                .then(data => {
                  if (data.ok) {
                    document.getElementById('pairingCodeDisplay').textContent = data.code;
                    document.getElementById('pairingCodeContainer').style.display = 'block';
                    pairBtn.textContent = 'Regenerate Code';
                  } else {
                    alert('Error: ' + data.error);
                    pairBtn.textContent = 'Get Pairing Code';
                  }
                  pairBtn.disabled = false;
                })
                .catch(err => {
                  alert('Network error: ' + err);
                  pairBtn.textContent = 'Get Pairing Code';
                  pairBtn.disabled = false;
                });
            });
          }

          document.getElementById('logoutBtn').addEventListener('click', function() {
            if (confirm('Are you sure you want to disconnect WhatsApp and change the linked phone number?')) {
              this.disabled = true;
              this.style.background = '#666';
              this.textContent = 'Disconnecting...';
              fetch('/api/wa-logout', { method: 'POST' })
                .then(r => r.json())
                .then(data => {
                  alert(data.msg || 'Disconnected successfully. Server is restarting, please wait.');
                  setTimeout(() => {
                    window.location.reload();
                  }, 3000);
                })
                .catch(err => {
                  alert('Error disconnecting: ' + err);
                  this.disabled = false;
                  this.style.background = '#ef4444';
                  this.textContent = 'Disconnect / Change Number';
                });
            }
          });
        </script>
      </body>
      </html>
    `);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

// IMPORTANT: Bind to 0.0.0.0 (all interfaces) so Railway's proxy can
// route external traffic to this server. Binding only to 127.0.0.1
// (the default when no host is specified) causes "connection refused"
// errors for all external clients including mobile browsers.
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Duromax site running at http://0.0.0.0:${PORT}`);
  console.log("--------------------------------------------------");
  console.log("[INFO] Waiting for WhatsApp Client initialization...");
  console.log("--------------------------------------------------");
});
// redeploy-trigger-comment-2