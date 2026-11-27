// Daily gas newsletter sender, run by .github/workflows/newsletter.yml.
//
// 1. Checks Belgrade time and whether today's issue already went out (a GitHub
//    artifact named gas-newsletter-sent-YYYY-MM-DD is the record; no database needed).
// 2. Opens /newsletter in Chromium. While exchanges have not published the next-day
//    RBP day-ahead auction results for D+1 (published ~17:30 CET), until 17:45,
//    reloads every five minutes.
// 3. Screenshots each [data-shot] section and emails summary text + inline images,
//    one message per recipient (SMTP when configured, otherwise Resend).
// 4. Writes sent=true to GITHUB_OUTPUT so the workflow uploads the "sent" artifact.
//
// Env: APP_URL, NEWSLETTER_TOKEN, NEWSLETTER_TO (comma-separated), NEWSLETTER_FROM (Resend only)
// Delivery: SMTP_HOST + SMTP_USER + SMTP_PASSWORD (e.g. Gmail app password), else RESEND_API_KEY.
// Optional: TEST_TO (send only there, not recorded), FORCE=true (ignore window and sent record)
// GitHub: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_OUTPUT (set by Actions)
import { appendFileSync } from "node:fs";
import { chromium } from "playwright";
import nodemailer from "nodemailer";

const env = (name, required = true) => {
  const value = process.env[name]?.trim();
  if (required && !value) throw new Error(`Missing ${name}`);
  return value ?? "";
};
const APP_URL = env("APP_URL").replace(/\/$/, "");
const TOKEN = env("NEWSLETTER_TOKEN");
const SMTP_HOST = env("SMTP_HOST", false);
const SMTP_USER = env("SMTP_USER", false);
const SMTP_PASSWORD = env("SMTP_PASSWORD", false);
const USE_SMTP = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASSWORD);
const RESEND_API_KEY = USE_SMTP ? "" : env("RESEND_API_KEY");
const FROM = USE_SMTP ? `Serbia Gas Daily <${SMTP_USER}>` : env("NEWSLETTER_FROM");
const TEST_TO = env("TEST_TO", false);
const FORCE = env("FORCE", false) === "true";
const RECIPIENTS = (TEST_TO || env("NEWSLETTER_TO"))
  .split(/[,;\s]+/)
  .map((s) => s.trim())
  .filter(Boolean);

// The issue must be out by 18:00 Belgrade and never later. RBP D+1 auction results land
// ~17:30; the first page build takes several minutes, so the job starts ~17:12.
const WINDOW_FROM = 17 * 60 + 5; // earliest start
const SEND_DEADLINE = 18 * 60; // nothing is sent at or after 18:00
const WAIT_UNTIL = 17 * 60 + 45; // wait for RBP D+1 auction results until 17:45
const SECTIONS = [
  "glance",
  "map-flows",
  "flows",
  "prices",
  "arbitrage",
  "arbitrage-analytics",
  "balance",
  "hu-storage",
  "capacity",
  "storage",
];
const TITLES = {
  glance: "At a glance",
  "map-flows": "Balkan physical flows map",
  flows: "Serbian border points",
  prices: "Day-ahead hub prices",
  arbitrage: "Regional arbitrage & transport economics",
  "arbitrage-analytics": "HU ↔ BG arbitrage analytics",
  capacity: "Capacity and bookings",
  balance: "Serbian demand, temperature and supply",
  "hu-storage": "Srbijagas storage balance in Hungary",
  storage: "Gas storage",
};
const SENT_ARTIFACT = (day) => `gas-newsletter-sent-${day}`;

function belgradeNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Belgrade",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekend: parts.weekday === "Sat" || parts.weekday === "Sun",
  };
}

/** True when today's issue was already recorded as sent by an earlier run. */
async function alreadySent(day) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) {
    console.warn("GITHUB_REPOSITORY/GITHUB_TOKEN not set; cannot check the sent record.");
    return false;
  }
  const url = `https://api.github.com/repos/${repo}/actions/artifacts?name=${SENT_ARTIFACT(day)}&per_page=1`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GitHub artifacts check HTTP ${response.status}`);
  const body = await response.json();
  return (body.total_count ?? 0) > 0;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

async function render(page, url) {
  // Three attempts: a first build warms the server caches, so a reload usually renders quickly.
  for (let attempt = 1; ; attempt++) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await page.waitForSelector('[data-newsletter-ready="true"]', { timeout: 12 * 60_000 });
      const raw = await page
        .locator("[data-newsletter-metadata]")
        .getAttribute("data-newsletter-metadata");
      if (!raw) throw new Error("Newsletter rendered without its metadata");
      return JSON.parse(raw);
    } catch (error) {
      const visible = (
        await page
          .locator("main")
          .first()
          .innerText()
          .catch(() => "")
      ).slice(0, 600);
      console.log(`Render attempt ${attempt}/3 failed: ${visible || error}`);
      if (attempt === 3)
        throw new Error(`Newsletter page did not render: ${visible || error}`, { cause: error });
    }
  }
}

async function main() {
  const now = belgradeNow();
  const today = now.day;
  if (!FORCE && !TEST_TO && (now.minutes < WINDOW_FROM || now.minutes >= SEND_DEADLINE)) {
    console.log(`Outside the send window (${now.minutes} min Belgrade); nothing to do.`);
    return;
  }
  if (!FORCE && !TEST_TO && (await alreadySent(today))) {
    console.log(`Today's issue (${today}) was already sent; skipping.`);
    return;
  }

  const browser = await chromium.launch();
  const images = [];
  let info;
  try {
    const page = await browser.newPage({
      viewport: { width: 800, height: 1200 },
      deviceScaleFactor: 1,
      colorScheme: "dark",
    });
    const pageUrl = `${APP_URL}/newsletter?token=${encodeURIComponent(TOKEN)}&today=${today}`;
    console.log("Opening newsletter view for rendering.");
    info = await render(page, pageUrl);
    // ENTSOG reads on the hosted app are slow on a cold cache; a second load is warm.
    // Only reload when there is still time to finish before the 18:00 cut-off.
    if (info.missing?.length && (FORCE || TEST_TO || belgradeNow().minutes < 17 * 60 + 40)) {
      console.log(`Missing after first load: ${info.missing.join(", ")}; loading once more.`);
      const second = await render(page, pageUrl);
      if ((second.missing?.length ?? 0) <= info.missing.length) info = second;
    }
    while (info.waitFor?.length && !FORCE && !TEST_TO && belgradeNow().minutes < WAIT_UNTIL) {
      console.log(`Waiting for: ${info.waitFor.join(", ")}`);
      await sleep(5 * 60_000);
      info = await render(page, pageUrl);
    }
    if (info.today !== today || !Array.isArray(info.summary)) {
      throw new Error("Newsletter metadata did not match the requested day");
    }
    await page.waitForTimeout(2_000); // map and charts settle

    for (const id of SECTIONS) {
      const element = await page.$(`[data-shot="${id}"]`);
      if (!element) continue;
      images.push({ id, png: await element.screenshot({ type: "png" }) });
    }
  } finally {
    await browser.close();
  }
  if (!images.length) throw new Error("No newsletter sections rendered");

  const net =
    typeof info.netIntoSerbia === "number"
      ? ` · Net into RS ${info.netIntoSerbia.toFixed(1)} mcm/d`
      : "";
  const ttf = typeof info.ttf === "number" ? ` · TTF €${info.ttf.toFixed(2)}` : "";
  const subject = `Serbia gas daily · ${today}${net}${ttf}`;
  const notes = [
    info.missing?.length ? `Unavailable at send time: ${info.missing.join(", ")}.` : "",
    info.awaiting?.length ? `No next-day price yet: ${info.awaiting.join(", ")}.` : "",
    info.waitFor?.length ? `Not published at send time: ${info.waitFor.join(", ")}.` : "",
  ].filter(Boolean);
  const html = `<!doctype html><html><body style="margin:0;background:#0d1216;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d1216;"><tr><td align="center">
<table role="presentation" width="760" cellpadding="0" cellspacing="0" style="max-width:760px;width:100%;font-family:Segoe UI,Arial,sans-serif;color:#e8edf2;">
<tr><td style="padding:24px 16px 8px;">
<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#5fd4cf;font-weight:600;">Serbia gas daily</div>
<div style="font-size:24px;line-height:1.25;font-weight:600;margin-top:4px;">${escapeHtml(today)}${info.flowDay ? ` · flows for gas day ${escapeHtml(info.flowDay)}` : ""}</div>
${
  Array.isArray(info.alerts) && info.alerts.length
    ? `<div style="margin:14px 0 0;padding:10px 12px;border:1px solid #b7791f;border-radius:6px;background:#1f1a10;">
<div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#f6ad55;font-weight:600;">Alerts</div>
${info.alerts.map((a) => `<div style="font-size:15px;line-height:1.5;margin-top:4px;">${escapeHtml(a)}</div>`).join("\n")}
</div>`
    : ""
}
<ul style="font-size:16px;line-height:1.55;padding-left:20px;margin:14px 0 0;">
${info.summary.map((line) => `<li style="margin-bottom:8px;">${escapeHtml(line)}</li>`).join("\n")}
</ul>
${notes.map((n) => `<p style="font-size:14px;color:#e5a13a;margin:8px 0 0;">${escapeHtml(n)}</p>`).join("\n")}
</td></tr>
${images
  .map(
    ({ id }) =>
      `<tr><td style="padding:8px 16px;"><img src="cid:${id}" alt="${escapeHtml(TITLES[id] ?? id)}" width="728" style="display:block;width:100%;max-width:728px;height:auto;border:0;border-radius:6px;"></td></tr>`,
  )
  .join("\n")}
<tr><td style="padding:16px;font-size:13px;color:#8b98a5;">Sources: ENTSOG, RBP, GIE AGSI+, EEX, CEGH, Balkan Gas Hub, CEEGEX, HEnEx, BRM, Open-Meteo. Automated daily summary from the Serbia gas dashboard.</td></tr>
</table></td></tr></table></body></html>`;
  const alertLines =
    Array.isArray(info.alerts) && info.alerts.length ? ["ALERTS", ...info.alerts, ""] : [];
  const text = [
    `Serbia gas daily · ${today}`,
    "",
    ...alertLines,
    ...info.summary,
    "",
    ...notes,
  ].join("\n");

  const port = Number(env("SMTP_PORT", false) || 465);
  const transport = USE_SMTP
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
        connectionTimeout: 30_000,
        greetingTimeout: 30_000,
        socketTimeout: 90_000,
      })
    : null;
  // Hard cut-off: a slow page build or a late GitHub schedule must not send after 18:00.
  if (!FORCE && !TEST_TO && belgradeNow().minutes >= SEND_DEADLINE) {
    console.log("18:00 Belgrade passed before the issue was ready; not sending today.");
    return;
  }
  let sent = 0;
  for (const to of RECIPIENTS) {
    try {
      if (transport) {
        await transport.sendMail({
          from: FROM,
          to,
          subject,
          html,
          text,
          attachments: images.map(({ id, png }) => ({
            filename: `${id}.png`,
            content: png,
            cid: id,
          })),
        });
      } else {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${RESEND_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from: FROM,
            to: [to],
            subject,
            html,
            text,
            attachments: images.map(({ id, png }) => ({
              filename: `${id}.png`,
              content: png.toString("base64"),
              content_id: id,
            })),
          }),
          // Not retried: a timeout after acceptance could otherwise send twice.
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status} ${await response.text()}`);
      }
      sent += 1;
    } catch (error) {
      console.error(
        `Send to recipient ${sent + 1} failed: ${error instanceof Error ? error.message : error}`,
      );
    }
    await sleep(600); // stay under provider rate limits
  }
  console.log(`Sent to ${sent} of ${RECIPIENTS.length} recipients.`);
  if (sent === 0) throw new Error("No email was sent");
  if (!TEST_TO && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `sent=true\nday=${today}\nrecipients=${sent}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
