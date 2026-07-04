<!-- AUTOIMPROVE_START -->
## AutoImprove

AutoImprove MCP (`mcp__autoimprove-core__*`) is a learned knowledge base of patterns and corrections from past sessions, O(1) indexed lookup, <10ms.

### When to prefer AutoImprove over native knowledge

Use AutoImprove for **learned patterns** - conventions, anti-patterns, corrections. Use native tools for general knowledge.

| user intent | Action | Example |
|---|---|---|
| ANY write/create/edit (code/docs/config/test) | `search_knowledge` FIRST | Before Write/Edit ANY file |
| "Add/Build/Implement/Create X" | `search_knowledge` scene | `search_knowledge({scene_json:'{"tech":["react"],"functional":["auth"]}'})` |
| "Fix/Debug/Resolve Y" | `search_knowledge` keywords | `search_knowledge({keywords: "async,error,state"})` | 
| "Generate/Write docs/README" | `search_knowledge` doc keywords | `search_knowledge({keywords: "documentation,report"})`|
| "How should I...?" | `search_knowledge` BEFORE answer | Check rules first |
| User corrects you repeatedly |  `/autoimprove-summarize` | Generate rules |

### Rules of thumb

- **Search BEFORE any write.** ANY write/Edit/Create operation (code/docs/config/tests/scripts) requires `search_knowledge` first. Don't write without checking - that repeats mistakes
- **Trust >=70% confidence rules** - Auto-apply; proven from 3+ confirmations. NOT suggestions, learned requirements.
- **Never skip "simple" or "non-code" tasks** - Docs/configs/scripts have conventions. Search is fast (<10ms).
- **Priority: Critical=MANDATORY, High = follow unless override, Medium/Low = advisory** 
- **Always cite rule ID** - "Following RULE-008 (pattern name)" for transparency. 
- **Scene auto-detected** - Tech from extensions ('.tsx'→react), domain from keywords. Manual scenes only for broad search.
- **Read ALL returned rules** - Top-N ranked, review all before applying.

### Search strategies

**Code (feature/fix/refactor):**
```typescript
search_knowledge({scene_json: '{"tech":["react"], "functional":["form"]}'})
search_knowledge({keywords: "validation,error-handling,async"})
```

**Docs/config/tests:** `search_knowledge({keywords: "documentation,build,test,ci})`
**Agent orchestration:** `search_knowledge({keywords: "agent,parallel,workflow"})`

**Bug fix:** `search_knowledge({keywords: "race-condition,memory-leak"})`

### If `~/.autoimprove/` doesn't exist

Tell user: *"AutoImprove not initialized. Run `cd ~/workspace/autoimprove && ./setup.sh`"*
<!-- AUTOIMPROVE_END -->
