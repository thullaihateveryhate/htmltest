const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");
const {
  buildMonitoringSummary,
  parseJsonLines,
  renderMarkdownReport,
  serializeJsonLines,
} = require("../monitoring/analyze");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const ROOT = path.join(__dirname, "..");
const LOGS_DIR = path.join(ROOT, "logs");
const FRONTEND_DATA_DIR = path.join(ROOT, "Frontend", "data");
const FIXTURE_PATH = path.join(ROOT, "monitoring", "fixtures", "security-events.sample.jsonl");

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

async function loadLiveEvents() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for live monitoring export.");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const all = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await client
      .from("monitoring_events")
      .select("*")
      .order("event_at", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(`Failed to load monitoring_events: ${error.message}`);
    }

    all.push(...(data || []));
    if (!data || data.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  return all;
}

function loadFixtureEvents() {
  const text = fs.readFileSync(FIXTURE_PATH, "utf8");
  return parseJsonLines(text);
}

async function generateAiSummary(summary) {
  if (!hasFlag("--ai")) {
    return null;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!apiKey) {
    console.warn("Skipping AI monitoring summary because OPENAI_API_KEY is not set.");
    return null;
  }

  const input = {
    source: summary.source,
    totals: summary.totals,
    security_counters: summary.security_counters,
    suspicious_findings: summary.suspicious_findings.slice(0, 8),
  };

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You are summarizing Stockd monitoring findings for a security report. Keep it concise, factual, and grounded in the provided metrics. Do not invent missing evidence.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(input),
            },
          ],
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.warn("AI summary request failed; falling back to deterministic narrative.");
    return null;
  }

  return payload && typeof payload.output_text === "string" && payload.output_text.trim()
    ? payload.output_text.trim()
    : null;
}

function writeOutputs(events, summary, markdown) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.mkdirSync(FRONTEND_DATA_DIR, { recursive: true });

  fs.writeFileSync(path.join(LOGS_DIR, "security-events.jsonl"), serializeJsonLines(events));
  fs.writeFileSync(path.join(LOGS_DIR, "traffic_summary.json"), JSON.stringify(summary, null, 2) + "\n");
  fs.writeFileSync(path.join(LOGS_DIR, "security_analysis_sample.md"), markdown);

  fs.writeFileSync(path.join(FRONTEND_DATA_DIR, "security-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  fs.writeFileSync(path.join(FRONTEND_DATA_DIR, "security-events-preview.json"), JSON.stringify(summary.recent_events, null, 2) + "\n");
}

async function main() {
  const useFixture = hasFlag("--fixture");
  const events = useFixture ? loadFixtureEvents() : await loadLiveEvents();
  const summary = buildMonitoringSummary(events, {
    source: useFixture ? "fixture" : "supabase_live",
  });

  const aiSummary = await generateAiSummary(summary);
  if (aiSummary) {
    summary.ai_summary = aiSummary;
    summary.ai_assisted = true;
  } else {
    summary.ai_assisted = false;
  }

  const markdown = renderMarkdownReport(summary);
  writeOutputs(events, summary, markdown);

  console.log(`Monitoring analysis generated from ${summary.source}.`);
  console.log(`Events analyzed: ${summary.totals.total_events}`);
  console.log(`Output JSON: ${path.join(LOGS_DIR, "traffic_summary.json")}`);
  console.log(`Output report: ${path.join(LOGS_DIR, "security_analysis_sample.md")}`);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
