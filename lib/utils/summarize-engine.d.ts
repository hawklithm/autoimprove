/**
 * Summarize Engine
 *
 * Core logic extracted from summarize.ts for reuse in the unified CLI.
 * Performs: init storage → batch rebuild → export → print results.
 *
 * This module uses dynamic imports because the MCP server code is compiled
 * separately (src/mcp-server-ts/dist/) from the CLI code (lib/). We resolve
 * paths relative to the package root at runtime.
 */
export interface SummarizeOptions {
    force: boolean;
    sessionDir: string;
    limit?: number;
    minConfidence: number;
    dryRun: boolean;
    noCleanup: boolean;
    noLlm: boolean;
    noExport: boolean;
}
export declare function runSummarize(options: SummarizeOptions): Promise<void>;
//# sourceMappingURL=summarize-engine.d.ts.map