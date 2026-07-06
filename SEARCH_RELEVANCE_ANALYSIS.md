# search_knowledge 检索相关度分析

## 问题现象
每次调用 `search_knowledge` 检索出来的规则相关度不高，无法准确匹配用户的场景和需求。

## 根本原因

### 1. **规则的 Scene 和 Keywords 数据为空**

检查现有规则的索引数据：
```json
{
  "id": "rule-001-b",
  "scenes": {
    "tech": [],
    "functional": [],
    "business": []
  },
  "keywords": []
}
```

**所有规则的 `scenes` 和 `keywords` 字段都是空数组！**

这导致：
- 无法通过技术栈（tech）匹配规则
- 无法通过功能域（functional）匹配规则
- 无法通过业务域（business）匹配规则
- 无法通过关键词（keywords）匹配规则

### 2. **检索算法依赖 Scene 和 Keywords**

#### 当前检索流程（`indexed-rule-matcher.ts`）：

```typescript
// 1. 通过 tech stack 匹配 (权重 0.4)
for (const tech of scene.tech) {
  const ruleIds = this.techIndex.get(tech);  // ❌ 返回空，因为规则没有 tech
  if (ruleIds) {
    this.addCandidateScore(candidateScores, ruleId, 0.4, `tech: ${tech}`);
  }
}

// 2. 通过 functional domain 匹配 (权重 0.5)
for (const func of scene.functional) {
  const ruleIds = this.functionalIndex.get(func);  // ❌ 返回空
  if (ruleIds) {
    this.addCandidateScore(candidateScores, ruleId, 0.5, `functional: ${func}`);
  }
}

// 3. 通过 keywords 匹配 (权重 0.6)
if (keywords) {
  for (const keyword of keywords) {
    const ruleIds = this.keywordIndex.get(keyword);  // ❌ 返回空
    if (ruleIds) {
      this.addCandidateScore(candidateScores, ruleId, 0.6, `keyword: ${keyword}`);
    }
  }
}
```

**结果：所有三个维度的匹配都失败，candidateScores 为空。**

#### 备用检索流程（`rule-matcher.ts`）：

```typescript
private calculateSceneOverlap(rule, scene) {
  const ruleScene = rule.scenes;
  
  if (!ruleScene || Object.keys(ruleScene).length === 0) {
    return { score: 0.5, reason: "no scene specified" };  // ⚠️ 默认返回 0.5
  }
  
  // 计算交集
  const techMatches = this.countSetIntersection(ruleScene.tech, scene.tech);
  // ruleScene.tech = [] → techMatches = 0
  
  const functionalMatches = this.countSetIntersection(ruleScene.functional, scene.functional);
  // ruleScene.functional = [] → functionalMatches = 0
  
  const ruleDimensions = 
    (ruleScene.tech.length > 0 ? 1 : 0) +        // 0
    (ruleScene.functional.length > 0 ? 1 : 0) +  // 0
    (ruleScene.business.length > 0 ? 1 : 0);     // 0
  
  if (ruleDimensions === 0) {
    return { score: 0.5, reason: "no scene specified" };  // ⚠️ 所有规则都返回 0.5
  }
}
```

**所有规则的场景相关度得分都是 0.5（"no scene specified"），没有区分度！**

### 3. **最终相关度计算**

```typescript
// 场景得分: 0.5 (所有规则相同)
// 关键词加成: 0.0 (keywords 为空)
// 总分 = (0.5 + 0.0) * confidence
//      = 0.5 * confidence

// 例如:
// rule-001-b: 0.5 * 0.804 = 0.402
// rule-002-c: 0.5 * 0.725 = 0.363
// rule-003-a: 0.5 * 0.660 = 0.330
```

**所有规则的相关度仅由 confidence 决定，与用户查询的场景和关键词无关！**

### 4. **排序逻辑**

```typescript
private sortMatches(matches: RuleMatch[]): RuleMatch[] {
  const priorityOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3
  };

  return matches.sort((a, b) => {
    // 1. 先按 priority 排序
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    
    // 2. priority 相同时按 relevance_score 排序
    return b.relevance_score - a.relevance_score;
  });
}
```

**最终结果：按 priority > confidence 排序，与用户查询内容无关！**

## 检索流程图

```
User Query
  ↓
search_knowledge({scene_json, keywords})
  ↓
IndexedRuleMatcher.fastMatch(scene, keywords)
  ↓
1. 查询 techIndex.get(tech)        → 空 (规则无 tech)
2. 查询 functionalIndex.get(func)  → 空 (规则无 functional)
3. 查询 keywordIndex.get(keyword)  → 空 (规则无 keywords)
  ↓
candidateScores = {} (空)
  ↓
回退到 RuleMatcher.matchRules()
  ↓
遍历所有规则:
  - calculateSceneOverlap() → 0.5 (所有规则相同)
  - calculateKeywordBoost() → 0.0 (规则无 keywords)
  - relevance = (0.5 + 0.0) * confidence
  ↓
按 priority > relevance 排序
  ↓
返回: 所有规则按优先级和置信度排序，与查询无关！
```

## 为什么会出现这个问题？

### 规则生成时未提取 Scene 和 Keywords

检查规则生成逻辑（`hybrid-rule-generator.ts`）:

```typescript
// Phase 1: Basic detection
const rule = {
  id: generateRuleId(),
  type: pattern.type,
  priority: determinePriority(pattern),
  confidence: pattern.confidence,
  scenes: {
    tech: [],        // ❌ 未填充
    functional: [],  // ❌ 未填充
    business: []     // ❌ 未填充
  },
  keywords: [],      // ❌ 未填充
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};
```

**规则生成时创建了空的 scenes 和 keywords，但没有后续填充逻辑！**

### Scene 检测器未被调用

虽然有 `EnhancedSceneDetector` 类，但在规则生成流程中未使用：

```typescript
// 应该有但缺失的逻辑:
const sceneDetector = new EnhancedSceneDetector();
const detectedScene = sceneDetector.detectFromPattern(pattern);

rule.scenes = detectedScene;
rule.keywords = sceneDetector.extractKeywords(pattern);
```

## 解决方案

### 方案 1: 修复规则生成流程（推荐）

在 `hybrid-rule-generator.ts` 中添加场景检测：

```typescript
async generateRules(patterns: Pattern[]): Promise<GeneratedRule[]> {
  const rules: GeneratedRule[] = [];
  
  for (const pattern of patterns) {
    // Phase 1: Basic detection
    const basicRule = this.detectBasicRule(pattern);
    
    // Phase 1.5: Scene detection (新增)
    const detectedScene = this.sceneDetector.detectFromPattern(pattern);
    const extractedKeywords = this.sceneDetector.extractKeywords(pattern);
    
    basicRule.scenes = detectedScene;
    basicRule.keywords = extractedKeywords;
    
    // Phase 2: LLM enhancement (optional)
    // ...
    
    rules.push(basicRule);
  }
  
  return rules;
}
```

### 方案 2: 批量修复现有规则

创建迁移脚本，为所有现有规则补充 scene 和 keywords：

```typescript
async function migrateExistingRules() {
  const rules = indexManager.listRules();
  const sceneDetector = new EnhancedSceneDetector();
  
  for (const rule of rules) {
    const content = contentManager.loadContent(rule.id);
    
    // 从规则内容提取 scene
    const scene = sceneDetector.detectFromRuleContent(content);
    const keywords = sceneDetector.extractKeywordsFromContent(content);
    
    // 更新规则
    indexManager.updateRule(rule.id, {
      scenes: scene,
      keywords: keywords
    });
  }
}
```

### 方案 3: 改进匹配算法（临时方案）

在 Scene/Keywords 数据缺失时，基于规则内容进行全文搜索：

```typescript
private matchByContent(
  rules: RuleIndexEntry[],
  scene: Scene,
  keywords: string[]
): RuleMatch[] {
  const matches: RuleMatch[] = [];
  
  for (const rule of rules) {
    const content = this.contentManager.loadContent(rule.id);
    const fullText = `${content.title} ${content.description} ${content.how_to_apply}`.toLowerCase();
    
    let score = 0.3; // 基础分
    
    // 匹配 tech keywords
    for (const tech of scene.tech) {
      if (fullText.includes(tech.toLowerCase())) {
        score += 0.2;
      }
    }
    
    // 匹配 functional keywords
    for (const func of scene.functional) {
      if (fullText.includes(func.toLowerCase())) {
        score += 0.3;
      }
    }
    
    // 匹配用户 keywords
    for (const keyword of keywords) {
      if (fullText.includes(keyword.toLowerCase())) {
        score += 0.2;
      }
    }
    
    if (score > 0.3) {
      matches.push({ rule, relevance_score: score, match_reason: "content match" });
    }
  }
  
  return matches;
}
```

## 现状总结

| 组件 | 状态 | 问题 |
|------|------|------|
| EnhancedSceneDetector | ✅ 已实现 | ❌ 未被调用 |
| IndexedRuleMatcher | ✅ 已实现 | ❌ 索引为空（规则无数据） |
| RuleMatcher | ✅ 已实现 | ❌ 所有规则得分 0.5（无区分度） |
| 规则生成流程 | ⚠️ 部分实现 | ❌ 未填充 scenes/keywords |
| 现有规则数据 | ❌ 数据缺失 | scenes=[], keywords=[] |

## 优先级建议

1. **高优先级**: 修复规则生成流程，确保新生成的规则包含 scene 和 keywords
2. **中优先级**: 创建迁移脚本，为现有规则补充数据
3. **低优先级**: 改进匹配算法作为临时兜底方案

## 验证步骤

修复后应验证：

1. 生成新规则时 scenes 和 keywords 不为空
   ```bash
   # 检查新生成的规则
   cat ~/.autoimprove/rules/index.json | jq '.rules[-1] | {id, scenes, keywords}'
   ```

2. 索引构建成功
   ```bash
   # 调用 get_index_stats 查看索引统计
   search_knowledge → 应该看到 keyword_count > 0, tech_count > 0
   ```

3. 检索相关度提升
   ```bash
   # 搜索特定场景
   search_knowledge({scene_json: '{"tech":["react"],"functional":["auth"]}', keywords: "token"})
   # 应该返回与 react+auth+token 真正相关的规则
   ```

## 总结

**根本原因：规则生成时未提取和存储 scene 和 keywords 数据，导致检索算法无法进行语义匹配，只能按 priority 和 confidence 排序，与用户查询内容无关。**

解决此问题需要：
1. 在规则生成流程中集成 EnhancedSceneDetector
2. 为现有规则补充缺失的元数据
3. 验证检索相关度提升
