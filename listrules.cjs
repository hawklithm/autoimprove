const { callMCPTool } = require('./src/skills-ts/dist/mcp-client.js');
(async () => {
  try {
    const r = await callMCPTool('list_rules', {});
    console.log("list_rules raw:", JSON.stringify(r).slice(0,400));
  } catch(e){ console.log("list_rules FAIL:", e.message); }
  process.exit(0);
})();
