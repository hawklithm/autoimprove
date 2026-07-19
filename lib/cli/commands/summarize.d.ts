interface SummarizeOptions {
    all?: boolean;
    enhance?: boolean;
    force?: boolean;
    minConfidence?: number;
    limit?: number;
    dryRun?: boolean;
    noCleanup?: boolean;
    noLlm?: boolean;
    noExport?: boolean;
    sessionDir?: string;
}
export declare function summarize(options: SummarizeOptions): Promise<void>;
export {};
//# sourceMappingURL=summarize.d.ts.map