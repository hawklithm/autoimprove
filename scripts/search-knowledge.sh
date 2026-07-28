#!/usr/bin/env bash
# Call AutoImprove's search_knowledge MCP tool without starting an agent.
#
# Usage:
#   ./scripts/search-knowledge.sh "sqlite,error"
#   ./scripts/search-knowledge.sh --keywords "sqlite,error"
#   ./scripts/search-knowledge.sh --scene-json '{"tech":["typescript"]}'
#   ./scripts/search-knowledge.sh --rule-id RULE-001

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_SERVER="$PROJECT_ROOT/src/mcp-server-ts/dist/index.js"

if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js is not installed or not on PATH." >&2
    exit 1
fi
if [ ! -f "$MCP_SERVER" ]; then
    echo "Error: MCP server build not found: $MCP_SERVER" >&2
    echo "Run: (cd src/mcp-server-ts && npm install && npm run build)" >&2
    exit 1
fi

# better-sqlite3 is a native module and its binary is tied to the Node.js ABI.
# Check it before starting the MCP server; otherwise the error only appears
# later as a JSON-RPC tool failure when the SQLite backend is first accessed.
MCP_SERVER_DIR="$PROJECT_ROOT/src/mcp-server-ts"
NODE_ABI="$(node -p 'process.versions.modules')"
if ! (cd "$MCP_SERVER_DIR" && node -e "require('better-sqlite3')") >/dev/null 2>&1; then
    echo "better-sqlite3 is incompatible with Node.js $(node -v) (ABI $NODE_ABI); rebuilding..." >&2
    if ! (cd "$MCP_SERVER_DIR" && npm rebuild better-sqlite3); then
        echo "Error: failed to rebuild better-sqlite3 for Node.js $(node -v) (ABI $NODE_ABI)." >&2
        echo "Run: (cd $MCP_SERVER_DIR && npm rebuild better-sqlite3)" >&2
        exit 1
    fi
fi

if ! (cd "$MCP_SERVER_DIR" && node -e "require('better-sqlite3')") >/dev/null 2>&1; then
    echo "Error: better-sqlite3 cannot be loaded by Node.js $(node -v) (ABI $NODE_ABI)." >&2
    exit 1
fi

echo "Node: $(node -v) (ABI $(node -p 'process.versions.modules'))" >&2
echo "Calling search_knowledge through the local MCP server..." >&2

REQUEST_FILE="$(mktemp "${TMPDIR:-/tmp}/autoimprove-search-request.XXXXXX")"
RESPONSE_FILE="$(mktemp "${TMPDIR:-/tmp}/autoimprove-search-response.XXXXXX")"
SERVER_LOG="$(mktemp "${TMPDIR:-/tmp}/autoimprove-search-server.XXXXXX")"
SERVER_PID=""
cleanup() {
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    rm -f "$REQUEST_FILE" "$RESPONSE_FILE" "$SERVER_LOG"
}
trap cleanup EXIT

cd "$PROJECT_ROOT"

# Build one MCP stdio request stream. The server processes initialize,
# initialized, and tools/call in order, then the request file reaches EOF.
node --input-type=module - "$@" > "$REQUEST_FILE" <<'NODE'
import { argv } from "node:process";

const cliArgs = argv.slice(2);
const args = {};
const positional = [];
const optionMap = {
  "--keywords": "keywords",
  "--scene-json": "scene_json",
  "--rule-id": "rule_id",
  "--scopes": "scopes",
  "--current-project": "current_project",
  "--organization-id": "organization_id",
};

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error(`Usage:
  ./scripts/search-knowledge.sh "keyword1,keyword2"
  ./scripts/search-knowledge.sh --keywords "keyword1,keyword2" [options]
  ./scripts/search-knowledge.sh --scene-json '{"tech":["typescript"]}'
  ./scripts/search-knowledge.sh --rule-id RULE-001

Options:
  --keywords <csv>       Comma-separated keywords
  --scene-json <json>    Scene JSON
  --rule-id <id>         Search one rule by ID
  --scopes <csv>         global,organization,project
  --current-project <p>  Project path for project-scoped rules
  --organization-id <id> Organization identifier
  --record-feedback      Record normal search feedback (default: skipped)
  --help                 Show this help`);
  process.exit(message ? 2 : 0);
}

for (let i = 0; i < cliArgs.length; i += 1) {
  const arg = cliArgs[i];
  if (arg === "--help" || arg === "-h") usage();
  if (arg === "--record-feedback") {
    args.skip_feedback = false;
    continue;
  }
  const key = optionMap[arg];
  if (key) {
    if (i + 1 >= cliArgs.length) usage(`${arg} requires a value`);
    args[key] = cliArgs[++i];
    continue;
  }
  if (arg.startsWith("--")) usage(`unknown option: ${arg}`);
  positional.push(arg);
}

if (!args.keywords && positional.length > 0) args.keywords = positional.join(" ");
// Do not send an empty keywords string: omission means list all rules.
if (args.skip_feedback === undefined) args.skip_feedback = true;

const messages = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "autoimprove-search-cli", version: "0.1.0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
  {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "search_knowledge", arguments: args },
  },
];
process.stdout.write(messages.map((message) => JSON.stringify(message)).join("\n") + "\n");
NODE

node "$MCP_SERVER" < "$REQUEST_FILE" > "$RESPONSE_FILE" 2> "$SERVER_LOG" &
SERVER_PID=$!

# The MCP server remains alive after stdin EOF. Poll until the tool response
# arrives, then terminate it in cleanup instead of waiting for a fixed timeout.
for _ in $(seq 1 600); do
    if grep -q '"id":2' "$RESPONSE_FILE"; then
        break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        cat "$SERVER_LOG" >&2
        echo "search_knowledge failed: MCP server exited before returning a response" >&2
        exit 1
    fi
    sleep 1
done

if ! grep -q '"id":2' "$RESPONSE_FILE"; then
    cat "$SERVER_LOG" >&2
    echo "search_knowledge failed: timed out waiting for MCP response" >&2
    exit 1
fi

cat "$SERVER_LOG" >&2
node --input-type=module - "$RESPONSE_FILE" <<'NODE'
import { readFileSync } from "node:fs";
import { argv } from "node:process";

const lines = readFileSync(argv[2], "utf8").split("\n").filter(Boolean);
const response = lines.map((line) => JSON.parse(line)).find((message) => message.id === 2);
if (!response) throw new Error("MCP tool response was not found");
if (response.error) throw new Error(`${response.error.code}: ${response.error.message}`);

const result = response.result;
if (result?.isError) {
  throw new Error(result.content?.map((item) => item.text ?? "").join("\n") || "MCP tool returned an error");
}

const text = result?.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n");
if (!text) throw new Error("MCP tool returned no text content");
console.log(text);
NODE
