#!/usr/bin/env bash
# Source this file from Bash scripts to validate native Node.js modules.

ensure_better_sqlite3() {
    local mcp_server_dir="$1"
    local force_rebuild="${2:-false}"
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

    if [[ "$force_rebuild" == "true" ]] || ! (cd "$mcp_server_dir" && "$node_bin" -e "const Database=require('better-sqlite3'); new Database(':memory:')") >/dev/null 2>&1; then
        echo "Rebuilding better-sqlite3 with $node_bin..." >&2
        # Force the install lifecycle script to run. This handles machines
        # with npm config set to ignore-scripts, which otherwise leaves the
        # old ABI-specific .node file untouched.
        # npm 11+ warns about the legacy --build-from-source CLI config. Pass
        # the node-gyp option through npm's supported environment variable so
        # npm itself does not treat it as an unknown command-line config.
        if ! (cd "$mcp_server_dir" && npm_config_build_from_source=true "${npm_command[@]}" rebuild better-sqlite3 --ignore-scripts=false) \
            || ! (cd "$mcp_server_dir" && "$node_bin" -e "const Database=require('better-sqlite3'); new Database(':memory:')") >/dev/null 2>&1; then
            echo "Initial better-sqlite3 rebuild failed; reinstalling its native build..." >&2
            rm -rf "$mcp_server_dir/node_modules/better-sqlite3/build"
            (cd "$mcp_server_dir" && npm_config_build_from_source=true "${npm_command[@]}" install better-sqlite3 --ignore-scripts=false --force)
        fi
    fi

    if ! (cd "$mcp_server_dir" && "$node_bin" -e "const Database=require('better-sqlite3'); new Database(':memory:')") >/dev/null 2>&1; then
        echo "Error: better-sqlite3 cannot be loaded by $node_bin (ABI $("$node_bin" -p 'process.versions.modules'))." >&2
        (cd "$mcp_server_dir" && "$node_bin" -e "try { console.error(require.resolve('better-sqlite3')); require('better-sqlite3'); } catch (error) { console.error(error.message); process.exitCode = 1; }") >&2 || true
        return 1
    fi
}
