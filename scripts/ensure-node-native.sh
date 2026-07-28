#!/usr/bin/env bash
# Source this file from Bash scripts to validate native Node.js modules.

ensure_better_sqlite3() {
    local mcp_server_dir="$1"
    local node_bin npm_bin npm_real npm_first_line

    node_bin="$(command -v node)"
    npm_bin="$(command -v npm)"
    npm_real="$("$node_bin" -e 'const fs=require("fs"); console.log(fs.realpathSync(process.argv[1]))' "$npm_bin")"
    npm_first_line="$(sed -n '1p' "$npm_real" 2>/dev/null || true)"

    echo "Node: $("$node_bin" -v) ($("$node_bin" -p 'process.execPath'))" >&2
    echo "Node ABI: $("$node_bin" -p 'process.versions.modules')" >&2
    echo "npm: $npm_bin (resolved: $npm_real)" >&2

    # npm-cli.js normally has a node shebang. Invoke it explicitly with the
    # selected node so npm lifecycle scripts cannot silently use another one.
    local -a npm_command
    if [[ "$npm_first_line" == *node* ]]; then
        npm_command=("$node_bin" "$npm_real")
    else
        npm_command=("$npm_bin")
    fi

    if ! (cd "$mcp_server_dir" && "$node_bin" -e "require('better-sqlite3')") >/dev/null 2>&1; then
        echo "Rebuilding better-sqlite3 with $node_bin..." >&2
        (cd "$mcp_server_dir" && "${npm_command[@]}" rebuild better-sqlite3)
    fi

    if ! (cd "$mcp_server_dir" && "$node_bin" -e "require('better-sqlite3')") >/dev/null 2>&1; then
        echo "Error: better-sqlite3 cannot be loaded by $node_bin (ABI $("$node_bin" -p 'process.versions.modules'))." >&2
        return 1
    fi
}
