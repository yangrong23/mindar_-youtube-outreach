import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "candidates.json");
const PORT = Number(process.env.PORT || 61881);
const CONFIG = {
  youtubeKey: process.env.YOUTUBE_API_KEY || "",
  sesRegion: process.env.AWS_SES_REGION || "us-east-1",
  sesFrom: process.env.AWS_SES_FROM || "",
  configurationSet: process.env.AWS_SES_CONFIGURATION_SET || "",
  dryRun: String(process.env.OUTREACH_DRY_RUN || "true").toLowerCase() !== "false",
  inviteBase: process.env.MINDAR_INVITE_BASE_URL || "https://web.mindar.ai",
  founder: process.env.FOUNDER_NAME || "The Mindar team",
  company: process.env.COMPANY_NAME || "Mindar",
  ultraOffer: process.env.ULTRA_OFFER || "6 months of Ultra",
  minSubscribers: Number(process.env.MIN_SUBSCRIBERS || 2000),
  maxSubscribers: Number(process.env.MAX_SUBSCRIBERS || 20000),
  demoEmail: process.env.DEMO_LOGIN_EMAIL || "123@gmail.com",
  demoPassword: process.env.DEMO_LOGIN_PASSWORD || "123@gmail.com",
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex")
};

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");

function readCandidates() {
  try {
    const items = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return Array.isArray(items)
      ? dedupeCandidates(items.filter(item => String(item?.email || "").trim()))
      : [];
  } catch {
    return [];
  }
}
function writeCandidates(items) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2));
}
function dedupeCandidates(items) {
  const seen = new Set();
  return items.filter(item => {
    const keys = [
      item.channelId && `channel:${item.channelId}`,
      item.channelUrl && `url:${String(item.channelUrl).toLowerCase()}`,
      item.email && `email:${String(item.email).trim().toLowerCase()}`
    ].filter(Boolean);
    if (keys.some(key => seen.has(key))) return false;
    keys.forEach(key => seen.add(key));
    return true;
  });
}
function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}
function html(res, body) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}
function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}
function body(req) {
  return new Promise((resolve, reject) => {
    let value = "";
    req.on("data", chunk => {
      value += chunk;
      if (value.length > 2_000_000) req.destroy();
    });
    req.on("end", () => {
      try { resolve(value ? JSON.parse(value) : {}); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}
function id() {
  return crypto.randomUUID();
}
function esc(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "").split(";").map(part => {
    const index = part.indexOf("=");
    if (index < 0) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}
function sessionValue(email) {
  const issuedAt = String(Math.floor(Date.now() / 1000));
  const payload = `${email}.${issuedAt}`;
  const signature = crypto.createHmac("sha256", CONFIG.sessionSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}
function validSession(value) {
  if (!value) return false;
  const parts = String(value).split(".");
  if (parts.length !== 4) return false;
  const [local, domain, issuedAt, signature] = parts;
  const email = `${local}.${domain}`;
  if (email !== CONFIG.demoEmail) return false;
  const payload = `${email}.${issuedAt}`;
  const expected = crypto.createHmac("sha256", CONFIG.sessionSecret).update(payload).digest("base64url");
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return false;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  const ageSeconds = Math.floor(Date.now() / 1000) - Number(issuedAt);
  return Number.isFinite(ageSeconds) && ageSeconds >= 0 && ageSeconds < 7 * 24 * 60 * 60;
}
function setSessionCookie(req, res, value) {
  const secure = req.headers["x-forwarded-proto"] === "https" || String(req.headers.host || "").startsWith("https://");
  res.setHeader("Set-Cookie", `mindar_outreach_session=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure ? "; Secure" : ""}`);
}
function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "mindar_outreach_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
}
function isAuthenticated(req) {
  return validSession(parseCookies(req).mindar_outreach_session);
}
function loginPage(error = "") {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mindar Outreach Login</title>
  <style>
    * { box-sizing:border-box; } body { margin:0; min-height:100vh; display:grid; place-items:center; font:14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; background:#f6f8fb; color:#17202b; }
    .card { width:min(420px, calc(100vw - 32px)); background:white; border:1px solid #e6eaf0; border-radius:12px; padding:28px; box-shadow:0 20px 60px #0f172a14; }
    h1 { margin:0 0 6px; font-size:22px; } p { margin:0 0 20px; color:#687383; }
    label { display:block; margin:14px 0 6px; font-weight:700; } input { width:100%; border:1px solid #d8dee8; border-radius:8px; padding:10px 11px; font:inherit; }
    button { width:100%; margin-top:18px; border:0; border-radius:8px; padding:10px 12px; background:#2563eb; color:white; font:inherit; cursor:pointer; }
    .error { margin:12px 0 0; padding:10px 12px; border-radius:8px; background:#fff7ed; color:#9a3412; }
    .small { margin-top:14px; font-size:12px; color:#687383; }
  </style>
</head>
<body>
  <form class="card" method="post" action="/login">
    <h1>Mindar YouTube Outreach Desk</h1>
    <p>请输入演示账号后继续。</p>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" value="${esc(CONFIG.demoEmail)}" autocomplete="username" required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">登录</button>
    ${error ? `<div class="error">${esc(error)}</div>` : ""}
    <div class="small">Demo account: ${esc(CONFIG.demoEmail)}</div>
  </form>
</body>
</html>`;
}
function trackedInvite(raw, candidate) {
  if (!raw) return "";
  try {
    const value = String(raw).trim();
    const url = /^https?:\/\//i.test(value)
      ? new URL(value)
      : new URL(CONFIG.inviteBase);
    if (!/^https?:\/\//i.test(value)) url.searchParams.set("invite_code", value);
    url.searchParams.set("outreach_id", candidate.id);
    url.searchParams.set("utm_source", "youtube_outreach");
    url.searchParams.set("utm_medium", "creator_email");
    url.searchParams.set("utm_campaign", candidate.segment || "creator_beta");
    url.searchParams.set("utm_content", candidate.channelId || candidate.id);
    return url.toString();
  } catch {
    return raw;
  }
}

function extractPublicEmail(channel, videos) {
  const sources = [
    { label: "channel description", text: channel.snippet?.description || "" },
    ...videos.map((video, index) => ({
      label: `video description: ${video.snippet?.title || `recent video ${index + 1}`}`,
      text: video.snippet?.description || ""
    }))
  ];
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  for (const source of sources) {
    const match = source.text.match(emailPattern)?.[0];
    if (match) return { email: match, source: source.label };
  }
  return { email: "", source: "" };
}

function buildPositioning(channel, videos, query) {
  const description = channel.snippet?.description || "";
  const titles = videos.map(video => video.snippet?.title || "").filter(Boolean);
  const text = `${channel.snippet?.title || ""} ${description} ${titles.join(" ")}`.toLowerCase();
  const audience = /phd|research|academic|thesis|literature|paper|scientific/.test(text)
    ? "研究者、博士生和学术工作者"
    : /medical|med school|nursing|anatomy|usmle|student|study/.test(text)
      ? "医学生、学生和学习型用户"
      : /consulting|founder|startup|business|entrepreneur/.test(text)
        ? "创业者、顾问和专业工作者"
        : "关注 AI、效率和工作流的创作者与知识工作者";
  const topics = [];
  if (/ai/.test(text)) topics.push("AI 工具");
  if (/research|academic|phd|thesis|literature|paper/.test(text)) topics.push("研究与资料整理");
  if (/productivity|workflow|automation|notion|obsidian|notes/.test(text)) topics.push("效率与知识管理");
  const focus = topics.length ? topics.slice(0, 2).join("、") : query;
  const latest = titles[0] ? `最近内容聚焦“${titles[0]}”` : "频道内容与 Mindar 的知识工作场景相关";
  return `${latest}；主要面向${audience}，适合从${focus}切入，邀请其用真实资料体验 Mindar。`;
}

async function youtube(pathname, params) {
  if (!CONFIG.youtubeKey) throw new Error("YOUTUBE_API_KEY 未配置");
  const url = new URL(`https://www.googleapis.com/youtube/v3/${pathname}`);
  Object.entries({ ...params, key: CONFIG.youtubeKey }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `YouTube API ${response.status}`);
  return data;
}

function classify(text) {
  const value = text.toLowerCase();
  if (/(exam prep|test prep|study tips|learning|education|teacher|teaching|classroom|student|school|college|university|med school|nursing|anatomy|usmle|edtech|lesson|curriculum)/.test(value)) return "education";
  if (/(youtube|content creator|content creation|video production|creator economy|social media marketing|educational channel|explainer video)/.test(value)) return "creator";
  if (/(phd|research|literature review|academic|papers|thesis|scientific)/.test(value)) return "research";
  if (/(consulting|consultant|case interview|strategy|founder|startup|business)/.test(value)) return "professional";
  if (/(ai tools|productivity|notion|workflow|automation)/.test(value)) return "ai_productivity";
  return "general";
}
function score(channel, videos, query) {
  const subscribers = Number(channel.statistics?.subscriberCount || 0);
  const views = videos.map(video => Number(video.statistics?.viewCount || 0));
  const avgViews = views.length ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : 0;
  const text = `${channel.snippet?.title || ""} ${channel.snippet?.description || ""} ${videos.map(v => `${v.snippet?.title} ${v.snippet?.description}`).join(" ")}`;
  const segment = classify(text);
  let points = 0;
  if (subscribers >= CONFIG.minSubscribers && subscribers <= CONFIG.maxSubscribers) points += 30;
  if (avgViews >= 5_000) points += 25;
  else if (avgViews >= 1_000) points += 15;
  if (videos.length >= 3) points += 20;
  if (segment !== "general") points += 20;
  if (/mind|ai|note|pdf|research|study|productivity|workflow|education|teaching|youtube|creator|review/.test(text.toLowerCase())) points += 5;
  return { score: Math.min(points, 100), segment, avgViews, query };
}

async function discover(keywords, existing = []) {
  const found = new Map();
  const existingKeys = new Set();
  for (const item of existing) {
    if (item.channelId) existingKeys.add(`channel:${item.channelId}`);
    if (item.channelUrl) existingKeys.add(`url:${String(item.channelUrl).toLowerCase()}`);
    if (item.email) existingKeys.add(`email:${String(item.email).trim().toLowerCase()}`);
  }
  for (const query of keywords.slice(0, 24)) {
    const results = await youtube("search", {
      part: "snippet",
      q: query,
      type: "channel",
      maxResults: "50",
      relevanceLanguage: "en",
      safeSearch: "moderate"
    });
    for (const item of results.items || []) {
      const channelId = item.snippet?.channelId || item.id?.channelId;
      if (channelId && !found.has(channelId) && !existingKeys.has(`channel:${channelId}`)) {
        found.set(channelId, { channelId, query });
      }
    }
  }
  const output = [];
  for (const item of found.values()) {
    const channelResponse = await youtube("channels", { part: "snippet,statistics,contentDetails", id: item.channelId });
    const channel = channelResponse.items?.[0];
    if (!channel) continue;
    const subscribers = Number(channel.statistics?.subscriberCount || 0);
    if (subscribers < CONFIG.minSubscribers || subscribers > CONFIG.maxSubscribers) continue;
    const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
    let videos = [];
    if (uploads) {
      const recent = await youtube("playlistItems", { part: "snippet,contentDetails", playlistId: uploads, maxResults: "5" });
      const videoIds = (recent.items || []).map(row => row.contentDetails?.videoId).filter(Boolean).join(",");
      if (videoIds) {
        const videoResponse = await youtube("videos", { part: "snippet,statistics", id: videoIds });
        videos = videoResponse.items || [];
      }
    }
    const contact = extractPublicEmail(channel, videos);
    if (!contact.email) continue;
    const candidateKeys = [
      `channel:${item.channelId}`,
      `url:https://www.youtube.com/channel/${item.channelId}`,
      `email:${contact.email.trim().toLowerCase()}`
    ];
    if (candidateKeys.some(key => existingKeys.has(key))) continue;
    const metrics = score(channel, videos, item.query);
    const positioning = buildPositioning(channel, videos, item.query);
    output.push({
      id: id(),
      channelId: item.channelId,
      channelTitle: channel.snippet?.title || "",
      channelUrl: `https://www.youtube.com/channel/${item.channelId}`,
      channelDescription: channel.snippet?.description || "",
      thumbnail: channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.default?.url || "",
      subscribers,
      videoCount: Number(channel.statistics?.videoCount || 0),
      recentVideos: videos.map(video => ({
        id: video.id,
        title: video.snippet?.title || "",
        publishedAt: video.snippet?.publishedAt || "",
        views: Number(video.statistics?.viewCount || 0),
        url: `https://www.youtube.com/watch?v=${video.id}`
      })),
      ...metrics,
      email: contact.email,
      contactSource: contact.source,
      inviteUrl: "",
      trackedInviteUrl: "",
      personalization: positioning,
      positioning,
      lastEmail: null,
      status: "needs_review",
      events: [{ type: "discovered", at: new Date().toISOString() }],
      createdAt: new Date().toISOString()
    });
    candidateKeys.forEach(key => existingKeys.add(key));
    if (output.length >= 20) break;
  }
  return output.sort((a, b) => b.score - a.score);
}

function emailFor(candidate) {
  const recipient = recipientName(candidate);
  const subject = `A personal invitation to share feedback on Mindar`;
  const focus = emailFocus(candidate);
  const invite = candidate.trackedInviteUrl || candidate.inviteUrl || CONFIG.inviteBase;
  const text = `Hello ${recipient},

My name is ${CONFIG.founder}, and I am part of the ${CONFIG.company} team.

I am reaching out because we would genuinely value your perspective on Mindar. I came across your channel while looking at ${candidate.query || "educational and knowledge-focused content"}, and your work stood out to us because of its focus on ${focus}.

Mindar's mission is to help people turn scattered information, questions, and ideas into knowledge and meaningful creative outcomes that can be understood, reused, and developed further. We hope Mindar can become more than an AI that responds to individual prompts. We are building it as a long-term AI workspace for learning, research, organization, and content creation.

At its core, Mindar is designed as an all-in-one knowledge management workspace: a place where people can collect sources, organize ideas, learn from materials, develop projects, and create useful outputs in one connected environment. Over time, we hope this accumulated knowledge and personal context can become an intelligent second brain that understands how each person works, what they care about, and how their ideas develop.

Here is a short introduction to Mindar:
https://www.tiktok.com/@mindar.com/video/7687910987881598222

Mindar is still at an early stage of refinement, and many of its features and workflows are continuing to evolve. For us, real user experience matters much more than a simple feature rating. The way you work with source material, evaluate AI output, and turn information into useful educational or creative content could help us understand where the product should go next.

You can learn more about Mindar through our practical guides:
${CONFIG.inviteBase}/guides

You can also follow Mindar on TikTok:
https://www.tiktok.com/@mindar.com

If you have some time, we would be grateful if you could try Mindar and share a few honest thoughts:

What kinds of learning, research, or content-production tasks do you usually work on?

Could Mindar help with the way you currently collect, organize, understand, or transform information?

Which outputs would be most valuable to you, such as structured notes, study materials, lesson resources, research briefs, scripts, slides, or short-form video ideas?

What feels useful, confusing, slow, or incomplete in the current experience?

If we could prioritize one improvement for Mindar, what would you want it to be?

There is no need to prepare anything formal. A short reply with your honest impression would mean a great deal to us. Your feedback at this early stage could directly influence our product decisions and help us build something that is genuinely useful for educators, researchers, learners, and creators.

As a thank-you for your time, we would be happy to provide ${CONFIG.ultraOffer} at no cost. After receiving your response, we will confirm the Ultra membership arrangement and add it to your account.

You can access Mindar here:
${invite}

If this is not relevant to you, please feel free to ignore this message or reply "no thanks," and we will not contact you again.

Thank you for your time and for the work you share with your audience. We would be honored to learn from your experience.

Warm regards,
${CONFIG.founder}
${CONFIG.company}`;
  return { subject, text };
}

function recipientName(candidate) {
  const localPart = String(candidate.email || "").split("@")[0].replace(/[._+-]+/g, " ").trim();
  const nameWords = localPart.split(/\s+/).filter(word => /^[a-zA-Z]{2,}$/.test(word));
  if (nameWords.length >= 2 && nameWords.length <= 3 && !/(info|hello|contact|support|admin|team|business|marketing|office)/i.test(localPart)) {
    return nameWords.map(word => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(" ");
  }
  const title = String(candidate.channelTitle || "").replace(/\b(channel|official|youtube|tv)\b/gi, "").replace(/[|:_-]+/g, " ").trim();
  const titleWords = title.split(/\s+/).filter(word => /^[a-zA-Z]{2,}$/.test(word));
  return titleWords.slice(0, 2).join(" ") || "there";
}

function emailFocus(candidate) {
  const segment = String(candidate.segment || "");
  if (segment === "education" || segment === "education_learning") return "education, teaching, and practical learning support";
  if (segment === "creator" || segment === "creator_content") return "educational storytelling and knowledge-focused content creation";
  if (segment === "research") return "research, evidence, and the practical use of information";
  if (segment === "ai_productivity") return "AI workflows, productivity, and knowledge organization";
  return "clear explanations and useful knowledge";
}

function sendSes(candidate, message) {
  return new Promise((resolve, reject) => {
    const args = [
      "sesv2", "send-email",
      "--from-email-address", CONFIG.sesFrom,
      "--destination", JSON.stringify({ ToAddresses: [candidate.email] }),
      "--content", JSON.stringify({ Simple: {
        Subject: { Data: message.subject, Charset: "UTF-8" },
        Body: { Text: { Data: message.text, Charset: "UTF-8" } }
      }}),
      "--region", CONFIG.sesRegion,
      "--output", "json"
    ];
    if (CONFIG.configurationSet) args.push("--configuration-set-name", CONFIG.configurationSet);
    execFile("aws", args, { env: process.env }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      try { resolve(JSON.parse(stdout)); } catch { resolve({ raw: stdout }); }
    });
  });
}

const UI = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/login") return html(res, loginPage());
    if (req.method === "POST" && url.pathname === "/login") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      const email = String(form.get("email") || "").trim();
      const password = String(form.get("password") || "");
      if (email !== CONFIG.demoEmail || password !== CONFIG.demoPassword) {
        return html(res, loginPage("账号或密码不正确"));
      }
      setSessionCookie(req, res, sessionValue(email));
      return redirect(res, "/");
    }
    if (req.method === "POST" && url.pathname === "/logout") {
      clearSessionCookie(res);
      return redirect(res, "/login");
    }
    if (!isAuthenticated(req)) {
      if (url.pathname.startsWith("/api/")) return json(res, 401, { error: "请先登录" });
      return redirect(res, "/login");
    }
    if (req.method === "GET" && url.pathname === "/") return html(res, UI);
    if (req.method === "GET" && url.pathname === "/api/config") {
      return json(res, 200, { dryRun: CONFIG.dryRun, sesReady: Boolean(CONFIG.sesFrom), youtubeReady: Boolean(CONFIG.youtubeKey) });
    }
    if (req.method === "GET" && url.pathname === "/api/candidates") return json(res, 200, readCandidates());
    if (req.method === "POST" && url.pathname === "/api/discover") {
      const input = await body(req);
      const keywords = Array.isArray(input.keywords) ? input.keywords.map(String).map(s => s.trim()).filter(Boolean).slice(0, 24) : [];
      if (!keywords.length) return json(res, 400, { error: "至少输入一个关键词" });
      const existing = readCandidates();
      const candidates = await discover(keywords, existing);
      const merged = dedupeCandidates([...candidates, ...existing]);
      writeCandidates(merged);
      return json(res, 200, { candidates, count: candidates.length });
    }
    if (req.method === "POST" && url.pathname === "/api/candidates/update") {
      const input = await body(req);
      const items = readCandidates();
      const index = items.findIndex(item => item.id === input.id);
      if (index < 0) return json(res, 404, { error: "候选不存在" });
      const current = items[index];
      const updated = { ...current, ...input };
      updated.trackedInviteUrl = trackedInvite(updated.inviteUrl, updated);
      updated.events = [...(current.events || []), { type: "updated", at: new Date().toISOString() }];
      items[index] = updated;
      writeCandidates(items);
      return json(res, 200, updated);
    }
    if (req.method === "POST" && url.pathname === "/api/email/preview") {
      const input = await body(req);
      const items = readCandidates();
      const index = items.findIndex(item => item.id === input.id);
      if (index < 0) return json(res, 404, { error: "候选不存在" });
      const candidate = { ...items[index], ...input };
      if (!candidate.email) return json(res, 400, { error: "请先填写公开商务邮箱" });
      if (!candidate.inviteUrl) return json(res, 400, { error: "请先填写邀请码或邀请链接" });
      candidate.trackedInviteUrl = trackedInvite(candidate.inviteUrl, candidate);
      candidate.lastEmail = { ...emailFor(candidate), at: new Date().toISOString() };
      items[index] = candidate;
      writeCandidates(items);
      return json(res, 200, { candidate, email: candidate.lastEmail });
    }
    if (req.method === "POST" && url.pathname === "/api/send") {
      const input = await body(req);
      const items = readCandidates();
      const candidate = items.find(item => item.id === input.id);
      if (!candidate) return json(res, 404, { error: "候选不存在" });
      if (!candidate.email || !candidate.inviteUrl) return json(res, 400, { error: "发送前必须填写公开商务邮箱和邀请链接" });
      if (!CONFIG.dryRun && !CONFIG.sesFrom) return json(res, 400, { error: "AWS_SES_FROM 未配置" });
      candidate.trackedInviteUrl = trackedInvite(candidate.inviteUrl, candidate);
      const message = candidate.lastEmail || emailFor(candidate);
      let provider = { dryRun: true };
      if (!CONFIG.dryRun) provider = await sendSes(candidate, message);
      candidate.status = CONFIG.dryRun ? "approved_dry_run" : "sent";
      candidate.lastEmail = { ...message, at: new Date().toISOString() };
      candidate.events = [...(candidate.events || []), { type: CONFIG.dryRun ? "approved_dry_run" : "sent", at: new Date().toISOString() }];
      writeCandidates(items);
      return json(res, 200, { candidate, provider });
    }
    if (req.method === "POST" && url.pathname === "/api/events") {
      const input = await body(req);
      const items = readCandidates();
      const candidate = items.find(item => item.id === input.outreachId);
      if (!candidate) return json(res, 404, { error: "outreach_id 不存在" });
      candidate.status = input.status || candidate.status;
      candidate.events = [...(candidate.events || []), { type: input.type || "event", at: new Date().toISOString(), data: input }];
      writeCandidates(items);
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname.startsWith("/unsubscribe/")) {
      const outreachId = url.pathname.split("/").pop();
      const items = readCandidates();
      const candidate = items.find(item => item.id === outreachId);
      if (candidate) {
        candidate.status = "unsubscribed";
        candidate.events = [...(candidate.events || []), { type: "unsubscribed", at: new Date().toISOString() }];
        writeCandidates(items);
      }
      return html(res, "<h2>You have been unsubscribed.</h2><p>Mindar will not send further outreach emails to this address.</p>");
    }
    if (req.method === "GET" && url.pathname === "/api/export.csv") {
      const fields = ["id", "channelTitle", "channelUrl", "segment", "score", "subscribers", "avgViews", "email", "contactSource", "inviteUrl", "status", "createdAt"];
      const rows = [fields.join(","), ...readCandidates().map(item => fields.map(field => `"${String(item[field] ?? "").replaceAll('"', '""')}"`).join(","))];
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=mindar-youtube-outreach.csv" });
      return res.end(rows.join("\n"));
    }
    res.writeHead(404);
    res.end("Not found");
  } catch (error) {
    json(res, 500, { error: error.message || "服务器错误" });
  }
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Mindar outreach desk: http://127.0.0.1:${PORT}`);
  console.log(`Dry run: ${CONFIG.dryRun ? "ON" : "OFF"}`);
});
