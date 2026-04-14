import { execSync } from "child_process";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, join } from "path";
import cron from "node-cron";

// Load .env
const envPath = resolve(import.meta.dirname, ".env");
const envContent = readFileSync(envPath, "utf-8");
const env = Object.fromEntries(
  envContent
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SLACK_BOT_TOKEN = env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL_ID = env.SLACK_CHANNEL_ID;
const CLAUDE_API_KEY = env.CLAUDE_API_KEY;
const WORKSPACE_PATH = env.WORKSPACE_PATH;
const CRON_SCHEDULE = env.CRON_SCHEDULE || "*/30 * * * *";
const LOOKBACK_HOURS = parseInt(env.LOOKBACK_HOURS || "6", 10);

const REPOS = [
  { repoDir: "360", subPaths: ["client", "server"] },
  { repoDir: "SSO", subPaths: ["client", "server"] },
  { repoDir: "shelfintel", subPaths: ["client", "server"] },
];

function git(cmd, cwd) {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: "utf-8", timeout: 10000 }).trim();
  } catch {
    return "";
  }
}

function collectRawActivity(repoDir, subPath) {
  const repoRoot = resolve(WORKSPACE_PATH, repoDir);
  const label = `${repoDir}/${subPath}`;
  const since = `${LOOKBACK_HOURS} hours ago`;

  const branch = git("rev-parse --abbrev-ref HEAD", repoRoot);

  // Commits
  const commitLog = git(
    `log --since="${since}" --no-merges --format="COMMIT:%h|%s|%an|%ar" -- ${subPath}`,
    repoRoot
  );
  const commits = commitLog.split("\n").filter((l) => l.startsWith("COMMIT:")).map((l) => l.replace("COMMIT:", ""));

  // File status
  const statusOutput = git(`status --short -- ${subPath}`, repoRoot);

  // Untracked files
  const untracked = git(`ls-files --others --exclude-standard -- ${subPath}`, repoRoot);

  // Diff stat
  const diff = git(`diff --stat -- ${subPath}`, repoRoot);

  // Actual code diff (truncated per project to manage tokens)
  const diffContent = git(`diff -U2 --no-color -- ${subPath}`, repoRoot);
  const stagedDiff = git(`diff --cached -U2 --no-color -- ${subPath}`, repoRoot);

  // Line counts
  const numstat = git(`diff --numstat -- ${subPath}`, repoRoot);
  let linesAdded = 0, linesRemoved = 0;
  numstat.split("\n").filter(Boolean).forEach((line) => {
    const [a, d] = line.split("\t");
    if (a !== "-") linesAdded += parseInt(a, 10);
    if (d !== "-") linesRemoved += parseInt(d, 10);
  });

  return {
    label,
    branch,
    commits,
    statusOutput,
    untracked,
    diff,
    diffContent: diffContent.slice(0, 4000) + (diffContent.length > 4000 ? "\n... [truncated]" : ""),
    stagedDiff: stagedDiff.slice(0, 2000) + (stagedDiff.length > 2000 ? "\n... [truncated]" : ""),
    linesAdded,
    linesRemoved,
  };
}

// Extract recent Copilot chat conversations from VS Code local storage
function getCopilotChats() {
  const sessionsDir = resolve(
    process.env.HOME,
    "Library/Application Support/Code/User/workspaceStorage/04ed59c7be11cb57c96bcebee1fa76cc/chatSessions"
  );

  try {
    const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
    const cutoff = Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000;
    const chats = [];

    for (const file of files) {
      const fpath = join(sessionsDir, file);
      const mtime = statSync(fpath).mtimeMs;
      // Skip sessions not modified within lookback window
      if (mtime < cutoff) continue;

      const content = readFileSync(fpath, "utf-8");
      for (const line of content.split("\n").filter(Boolean)) {
        try {
          const data = JSON.parse(line);
          if (data.kind !== 0) continue;
          const v = data.v;
          const title = v.customTitle || "Untitled";
          const requests = v.requests || [];

          // Only include requests within the lookback window
          const recentRequests = requests.filter((r) => r.timestamp >= cutoff);
          if (recentRequests.length === 0) continue;

          const messages = recentRequests.map((req) => {
            const userMsg = req.message?.text || "";
            // Extract assistant response text (kind=None entries are the actual response text)
            const respParts = (req.response || [])
              .filter((r) => r.kind === undefined || r.kind === null)
              .map((r) => (typeof r.value === "string" ? r.value : ""))
              .filter(Boolean);
            const assistantMsg = respParts.join("").slice(0, 1000); // truncate long responses
            return { user: userMsg.slice(0, 500), assistant: assistantMsg };
          });

          chats.push({ title, messageCount: messages.length, messages });
        } catch {}
      }
    }
    return chats;
  } catch (e) {
    console.error("Failed to read chat sessions:", e.message);
    return [];
  }
}

// Find the workspace storage ID dynamically (in case it changes)
function findWorkspaceStorageId() {
  const storageRoot = resolve(process.env.HOME, "Library/Application Support/Code/User/workspaceStorage");
  try {
    const dirs = readdirSync(storageRoot);
    for (const dir of dirs) {
      const chatDir = join(storageRoot, dir, "chatSessions");
      try {
        const stat = statSync(chatDir);
        if (stat.isDirectory()) {
          // Check if this workspace matches by looking for our workspace path in workspace.json
          const wsFile = join(storageRoot, dir, "workspace.json");
          try {
            const ws = JSON.parse(readFileSync(wsFile, "utf-8"));
            const folder = ws.folder || "";
            if (folder.includes("360-SSO")) return dir;
          } catch {}
        }
      } catch {}
    }
  } catch {}
  return "04ed59c7be11cb57c96bcebee1fa76cc"; // fallback to known ID
}

const WORKSPACE_STORAGE_ID = findWorkspaceStorageId();

async function askClaude(activities, chats) {
  // Build raw git data
  const gitData = activities
    .filter((a) => a.statusOutput || a.commits.length > 0 || a.untracked)
    .map((a) => {
      let section = `=== ${a.label} (branch: ${a.branch}) ===\n`;
      if (a.commits.length > 0) section += `Commits:\n${a.commits.join("\n")}\n\n`;
      if (a.statusOutput) section += `Changed files:\n${a.statusOutput}\n\n`;
      if (a.untracked) section += `New files:\n${a.untracked}\n\n`;
      if (a.diffContent) section += `Code diff:\n${a.diffContent}\n\n`;
      if (a.stagedDiff) section += `Staged diff:\n${a.stagedDiff}\n\n`;
      section += `Lines: +${a.linesAdded} / -${a.linesRemoved}\n`;
      return section;
    })
    .join("\n\n");

  // Build chat context
  const chatData = chats
    .map((chat) => {
      let section = `=== Chat: "${chat.title}" (${chat.messageCount} messages) ===\n`;
      for (const msg of chat.messages.slice(-10)) { // last 10 messages per chat
        section += `User: ${msg.user}\n`;
        if (msg.assistant) section += `Assistant: ${msg.assistant.slice(0, 500)}\n`;
        section += "\n";
      }
      return section;
    })
    .join("\n");

  const hasGit = gitData.trim().length > 0;
  const hasChats = chatData.trim().length > 0;

  if (!hasGit && !hasChats) {
    return "No development activity detected in the last " + LOOKBACK_HOURS + " hours.";
  }

  const prompt = `You are a dev activity reporter. Analyze the following data from a developer's workspace and write a clear, actionable Slack update.

The workspace has these projects:
- *360*: A business management platform for retail/survey operations (client = Next.js frontend, server = Node.js/Express + Drizzle ORM + PostgreSQL)
- *SSO*: Single Sign-On authentication service (client = Next.js, server = Node.js)
- *shelfintel*: A shelf intelligence / retail analytics tool (client = Next.js, server = Node.js)

${hasGit ? `## Git Changes (last ${LOOKBACK_HOURS}h)\n${gitData}` : "No git changes detected."}

${hasChats ? `## Copilot Chat Sessions (last ${LOOKBACK_HOURS}h)\nThese are conversations the developer had with GitHub Copilot AI while coding:\n${chatData}` : ""}

Write a Slack update that:
1. *Summary line*: One sentence of what was accomplished overall
2. *Features Built / Worked On*: Group by feature (e.g. "Employee Management", "SSO Auth Flow"). For each, 2-3 bullet points describing what was done in plain English. Use the chat conversations to understand the *intent* and *context* behind the code changes.
3. *Discussions & Decisions*: Key technical decisions or discussions from the chat sessions (e.g. "Chose PostgreSQL over MongoDB for relational data model", "Redesigned auth middleware for multi-tenant support")
4. *In Progress / Next Up*: What appears to be ongoing based on uncommitted changes and recent chats
5. *Stats*: Total files changed, lines added/removed

Rules:
- Use Slack mrkdwn: *bold*, _italic_, \`code\`, • for bullets
- Do NOT list raw file paths. Describe actual functionality.
- Keep it under 400 words. Be specific about what features do.
- Start directly with content, no preamble.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  if (data.error) {
    console.error("Claude API error:", data.error);
    return null;
  }

  return data.content?.[0]?.text || null;
}

async function sendToSlack(text) {
  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const blocks = [
    { type: "header", text: { type: "plain_text", text: `📊 Dev Update — ${now}` } },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text } },
  ];

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({
      channel: SLACK_CHANNEL_ID,
      blocks,
      text: "Dev activity update",
    }),
  });

  const data = await res.json();
  if (!data.ok) {
    console.error(`Slack API error: ${data.error}`);
  } else {
    console.log(`[${new Date().toISOString()}] Update sent to Slack`);
  }
}

async function runUpdate() {
  console.log(`[${new Date().toISOString()}] Collecting workspace activity...`);

  // Collect git activity
  const activities = REPOS.flatMap((r) =>
    r.subPaths.map((sub) => collectRawActivity(r.repoDir, sub))
  );

  // Collect Copilot chat history
  console.log(`[${new Date().toISOString()}] Reading Copilot chat sessions...`);
  const chats = getCopilotChats();
  console.log(`[${new Date().toISOString()}] Found ${chats.length} active chat session(s)`);

  const hasAnyActivity = activities.some((a) => a.statusOutput || a.commits.length > 0 || a.untracked) || chats.length > 0;
  if (!hasAnyActivity) {
    console.log(`[${new Date().toISOString()}] No activity detected, skipping.`);
    return;
  }

  // Send to Claude for intelligent summary
  console.log(`[${new Date().toISOString()}] Generating summary with Claude...`);
  const summary = await askClaude(activities, chats);
  if (!summary) {
    console.error("Failed to generate summary, skipping.");
    return;
  }

  console.log(`[${new Date().toISOString()}] Posting to Slack...`);
  await sendToSlack(summary);
}

// Run once immediately
runUpdate();

// Schedule
cron.schedule(CRON_SCHEDULE, () => {
  runUpdate();
});

console.log(`Jarvis updater running. Schedule: "${CRON_SCHEDULE}". Monitoring: ${WORKSPACE_PATH}`);
