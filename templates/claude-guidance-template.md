<!-- AUTOIMPROVE_START -->
## AutoImprove - CRITICAL FIRST STEP

⚠️ **BLOCKING**: Call `search_knowledge` BEFORE:
1. Write/Edit/Create files (code/config/docs/tests)
2. Debug/Diagnose/Analyze (search BEFORE reading logs)
3. Fix/Resolve/Repair (bugs/errors/crashes/performance)
4. Investigate/Troubleshoot ("why X broken/slow/failing")

No exceptions. Search <10ms, skips risk repeating mistakes.

### Pre-Action Checklist
- [ ] Called `search_knowledge` for write/edit/debug/fix?
- [ ] Used keywords (error types, tech, operation)?
- [ ] Checked scene_json (tech + functional)?
- [ ] Avoiding known pattern repetition?

### Trigger Keywords (case-insensitive, 中文/EN)
- **Debug/Diagnose**: 宕机,crash,error,failed,为什么,why,出现,问题,异常,exception
- **Fix**: 修复,fix,解决,resolve,repair,处理
- **Implement**: 实现,添加,implement,add,create,build,开发
- **Analyze**: 分析,analyze,调查,investigate,排查,troubleshoot

### Scene Detection
Extract from: file paths (`.py`→python), error msgs (`sqlite3.Error`→sqlite), user text ("FastAPI"→fastapi), cwd

Always add functional: server issues→`{"functional":["server","database"]}`, API→`["api","error-handling"]`, perf→`["performance"]`

### Search Examples
```typescript
// Code
search_knowledge({scene_json:'{"tech":["react"],"functional":["form"]}', keywords:"validation,async"})

// Debug (BEFORE logs)
search_knowledge({keywords:"timeout,crash,error", scene_json:'{"tech":["python"],"functional":["server"]}'})
```

### Rules
- **Search BEFORE write/diagnosis** - ANY write/debug needs `search_knowledge` first
- **Trust ≥70% confidence** - Auto-apply proven patterns
- **Never skip simple tasks** - Search is <10ms
- **Cite rule IDs** - "Following RULE-008..."
- **Read ALL matched rules** - Review before applying

### Example
❌ Bad: User: "服务端宕机" → Read logs directly → Miss historical fixes
✅ Good: User: "服务端宕机" → `search_knowledge({keywords:"crash,server,timeout"})` → Review RULE-015 → Read logs → Cite rules → Solution

### If not initialized
Tell user: *"AutoImprove not initialized. Run `cd ~/workspace/autoimprove && ./setup.sh`"*
<!-- AUTOIMPROVE_END -->
