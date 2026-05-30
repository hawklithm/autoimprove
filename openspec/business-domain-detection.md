# 业务域混合检测方案

## 数据结构

### 项目配置

```typescript
// .autoimprove.json
interface AutoImproveConfig {
  version: string;
  
  // 业务域配置
  business_domains: {
    [domainName: string]: BusinessDomainConfig;
  };
  
  // 推断配置
  inference: {
    enabled: boolean;           // 是否启用自动推断
    confidence_threshold: number; // 推断结果的最低置信度
    suggest_new_domains: boolean; // 是否提示新发现的域
  };
}

interface BusinessDomainConfig {
  // 显式配置（用户手写）
  keywords?: string[];          // 关键词列表
  paths?: string[];             // 路径模式（支持 glob）
  files?: string[];             // 特定文件
  
  // 元数据
  description?: string;         // 业务域描述
  source: 'manual' | 'inferred' | 'hybrid'; // 来源
  confidence?: number;          // 置信度（仅 inferred/hybrid）
  last_verified?: string;       // 最后验证时间
}
```

### 配置示例

```json
{
  "version": "0.1.0",
  "business_domains": {
    "user-management": {
      "description": "用户账户、认证、权限管理",
      "keywords": ["user", "用户", "account", "profile", "permission"],
      "paths": [
        "src/modules/user/**",
        "src/features/auth/**",
        "src/components/User*"
      ],
      "files": [
        "src/services/userService.ts",
        "src/hooks/useUser.ts"
      ],
      "source": "manual",
      "last_verified": "2026-05-30"
    },
    
    "billing": {
      "description": "订单、支付、发票",
      "keywords": ["billing", "payment", "invoice", "订单", "支付"],
      "paths": [
        "src/modules/billing/**",
        "src/features/payment/**"
      ],
      "source": "hybrid",
      "confidence": 0.85,
      "last_verified": "2026-05-30"
    },
    
    "analytics": {
      "description": "数据分析、报表、追踪",
      "paths": ["src/modules/analytics/**"],
      "source": "inferred",
      "confidence": 0.75,
      "last_verified": "2026-05-28"
    }
  },
  
  "inference": {
    "enabled": true,
    "confidence_threshold": 0.6,
    "suggest_new_domains": true
  }
}
```

## 推断算法

### 1. 项目结构分析

```typescript
interface InferredDomain {
  name: string;
  confidence: number;
  evidence: {
    type: 'directory' | 'package' | 'readme' | 'imports';
    source: string;
    weight: number;
  }[];
}

async function inferBusinessDomains(
  projectRoot: string
): Promise<InferredDomain[]> {
  const domains: Map<string, InferredDomain> = new Map();
  
  // 信号 1：模块目录结构
  await analyzeModuleStructure(projectRoot, domains);
  
  // 信号 2：package.json
  await analyzePackageJson(projectRoot, domains);
  
  // 信号 3：README.md
  await analyzeReadme(projectRoot, domains);
  
  // 信号 4：代码导入关系
  await analyzeImportGraph(projectRoot, domains);
  
  // 计算最终置信度
  return Array.from(domains.values())
    .map(domain => ({
      ...domain,
      confidence: calculateConfidence(domain.evidence)
    }))
    .filter(d => d.confidence >= 0.6)
    .sort((a, b) => b.confidence - a.confidence);
}
```

### 2. 模块目录结构分析

```typescript
async function analyzeModuleStructure(
  projectRoot: string,
  domains: Map<string, InferredDomain>
): Promise<void> {
  // 查找常见的模块目录
  const modulePaths = [
    'src/modules',
    'src/features',
    'src/domains',
    'packages',
    'apps'
  ];
  
  for (const basePath of modulePaths) {
    const fullPath = path.join(projectRoot, basePath);
    if (!await exists(fullPath)) continue;
    
    // 列出子目录
    const subdirs = await fs.readdir(fullPath, { withFileTypes: true });
    
    for (const dir of subdirs) {
      if (!dir.isDirectory()) continue;
      
      const domainName = normalizeDomainName(dir.name);
      const domain = getOrCreateDomain(domains, domainName);
      
      domain.evidence.push({
        type: 'directory',
        source: path.join(basePath, dir.name),
        weight: 0.8  // 目录结构是强信号
      });
    }
  }
}

function normalizeDomainName(name: string): string {
  // user-management, userManagement, user_management → user-management
  return name
    .replace(/([a-z])([A-Z])/g, '$1-$2')  // camelCase → kebab-case
    .replace(/_/g, '-')                    // snake_case → kebab-case
    .toLowerCase();
}
```

### 3. package.json 分析

```typescript
async function analyzePackageJson(
  projectRoot: string,
  domains: Map<string, InferredDomain>
): Promise<void> {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!await exists(pkgPath)) return;
  
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
  
  // 从 package name 推断
  // @myapp/user-service → user
  // @myapp/billing-api → billing
  if (pkg.name) {
    const match = pkg.name.match(/@[\w-]+\/([\w-]+)/);
    if (match) {
      const domainName = extractDomainFromName(match[1]);
      if (domainName) {
        const domain = getOrCreateDomain(domains, domainName);
        domain.evidence.push({
          type: 'package',
          source: `package.json: ${pkg.name}`,
          weight: 0.7
        });
      }
    }
  }
  
  // 从 description 推断
  if (pkg.description) {
    const keywords = extractBusinessKeywords(pkg.description);
    for (const keyword of keywords) {
      const domain = getOrCreateDomain(domains, keyword);
      domain.evidence.push({
        type: 'package',
        source: `package.json description: "${pkg.description}"`,
        weight: 0.5
      });
    }
  }
}

function extractDomainFromName(name: string): string | null {
  // user-service, user-api, user-management → user
  // billing-service → billing
  const patterns = [
    /^([\w-]+)-(service|api|app|module|feature)$/,
    /^([\w-]+)-management$/,
    /^([\w-]+)$/
  ];
  
  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match) return match[1];
  }
  
  return null;
}
```

### 4. README 分析

```typescript
async function analyzeReadme(
  projectRoot: string,
  domains: Map<string, InferredDomain>
): Promise<void> {
  const readmePath = path.join(projectRoot, 'README.md');
  if (!await exists(readmePath)) return;
  
  const content = await fs.readFile(readmePath, 'utf-8');
  
  // 查找常见的业务关键词
  const businessKeywords = extractBusinessKeywords(content);
  
  for (const keyword of businessKeywords) {
    const domain = getOrCreateDomain(domains, keyword);
    domain.evidence.push({
      type: 'readme',
      source: 'README.md',
      weight: 0.6
    });
  }
}

function extractBusinessKeywords(text: string): string[] {
  // 常见的业务域关键词
  const patterns = [
    // 英文
    /\b(user|account|profile|auth|authentication|authorization)\b/gi,
    /\b(billing|payment|invoice|subscription|order)\b/gi,
    /\b(analytics|tracking|metrics|reporting)\b/gi,
    /\b(notification|email|messaging)\b/gi,
    /\b(content|article|post|media)\b/gi,
    /\b(search|indexing|discovery)\b/gi,
    
    // 中文
    /用户|账户|认证|授权/g,
    /订单|支付|账单|发票/g,
    /分析|统计|报表|追踪/g,
    /通知|消息|邮件/g,
    /内容|文章|媒体/g,
  ];
  
  const keywords = new Set<string>();
  
  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const keyword = normalizeDomainName(match[1] || match[0]);
      keywords.add(keyword);
    }
  }
  
  return Array.from(keywords);
}
```

### 5. 代码导入关系分析

```typescript
async function analyzeImportGraph(
  projectRoot: string,
  domains: Map<string, InferredDomain>
): Promise<void> {
  // 这个比较复杂，需要解析代码
  // 简化版：只看文件路径中的模块名
  
  const sourceFiles = await glob('src/**/*.{ts,tsx,js,jsx}', {
    cwd: projectRoot
  });
  
  for (const file of sourceFiles) {
    // 从路径提取可能的业务域
    // src/modules/user/UserService.ts → user
    // src/features/billing/BillingAPI.ts → billing
    
    const pathParts = file.split('/');
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (['modules', 'features', 'domains'].includes(part)) {
        const domainName = normalizeDomainName(pathParts[i + 1]);
        const domain = getOrCreateDomain(domains, domainName);
        
        // 权重较低，因为只是路径推断
        domain.evidence.push({
          type: 'imports',
          source: file,
          weight: 0.4
        });
      }
    }
  }
}
```

### 6. 置信度计算

```typescript
function calculateConfidence(evidence: InferredDomain['evidence']): number {
  if (evidence.length === 0) return 0;
  
  // 加权平均，但有上限
  const totalWeight = evidence.reduce((sum, e) => sum + e.weight, 0);
  const maxConfidence = Math.min(totalWeight, 1.0);
  
  // 多样性加成：如果证据来自多个不同类型的信号，提高置信度
  const uniqueTypes = new Set(evidence.map(e => e.type)).size;
  const diversityBonus = (uniqueTypes - 1) * 0.1; // 每多一种类型 +0.1
  
  return Math.min(maxConfidence + diversityBonus, 1.0);
}
```

## 配置合并策略

### 初始化流程

```typescript
async function initializeBusinessDomains(
  projectRoot: string
): Promise<AutoImproveConfig> {
  // 1. 尝试加载现有配置
  const existingConfig = await loadConfig(projectRoot);
  
  if (existingConfig) {
    // 配置已存在，检查是否需要更新
    return await updateConfig(projectRoot, existingConfig);
  }
  
  // 2. 首次初始化：推断 + 用户确认
  const inferredDomains = await inferBusinessDomains(projectRoot);
  
  // 3. 生成配置草案
  const draftConfig = generateDraftConfig(inferredDomains);
  
  // 4. 请求用户确认
  const confirmedConfig = await requestUserConfirmation(draftConfig);
  
  // 5. 保存配置
  await saveConfig(projectRoot, confirmedConfig);
  
  return confirmedConfig;
}
```

### 日常检测流程

```typescript
async function detectBusinessDomains(
  session: Session,
  config: AutoImproveConfig
): Promise<string[]> {
  const detectedDomains = new Set<string>();
  
  // 1. 优先使用配置
  for (const [domainName, domainConfig] of Object.entries(config.business_domains)) {
    if (matchesDomainConfig(session, domainConfig)) {
      detectedDomains.add(domainName);
    }
  }
  
  // 2. 如果启用了推断，且配置未覆盖
  if (config.inference.enabled && detectedDomains.size === 0) {
    const inferredDomains = await inferFromSession(session);
    
    for (const domain of inferredDomains) {
      if (domain.confidence >= config.inference.confidence_threshold) {
        detectedDomains.add(domain.name);
        
        // 3. 如果发现新域，提示用户
        if (config.inference.suggest_new_domains && !config.business_domains[domain.name]) {
          await suggestNewDomain(domain);
        }
      }
    }
  }
  
  return Array.from(detectedDomains);
}

function matchesDomainConfig(
  session: Session,
  config: BusinessDomainConfig
): boolean {
  // 检查关键词
  if (config.keywords) {
    const text = session.user_input.toLowerCase();
    if (config.keywords.some(kw => text.includes(kw.toLowerCase()))) {
      return true;
    }
  }
  
  // 检查文件路径
  if (config.paths) {
    for (const edit of session.edits) {
      if (config.paths.some(pattern => minimatch(edit.file_path, pattern))) {
        return true;
      }
    }
  }
  
  // 检查特定文件
  if (config.files) {
    const editedFiles = session.edits.map(e => e.file_path);
    if (config.files.some(file => editedFiles.includes(file))) {
      return true;
    }
  }
  
  return false;
}
```

### 配置演进

```typescript
async function updateConfig(
  projectRoot: string,
  config: AutoImproveConfig
): Promise<AutoImproveConfig> {
  // 1. 重新推断当前项目结构
  const currentDomains = await inferBusinessDomains(projectRoot);
  
  // 2. 对比配置
  const changes = compareConfigs(config.business_domains, currentDomains);
  
  if (changes.newDomains.length > 0) {
    // 发现新的业务域
    await suggestAddDomains(changes.newDomains);
  }
  
  if (changes.missingDomains.length > 0) {
    // 配置中的域在代码中找不到了
    await suggestRemoveDomains(changes.missingDomains);
  }
  
  if (changes.changedDomains.length > 0) {
    // 域的结构发生了变化
    await suggestUpdateDomains(changes.changedDomains);
  }
  
  return config;
}

interface ConfigChanges {
  newDomains: InferredDomain[];      // 新发现的域
  missingDomains: string[];          // 配置中有但代码中没有的域
  changedDomains: {                  // 结构变化的域
    name: string;
    oldPaths: string[];
    newPaths: string[];
  }[];
}
```

## 用户交互

### 首次初始化

```
$ autoimprove init

🔍 分析项目结构...

发现以下业务域：

1. user-management (置信度: 0.95)
   路径: src/modules/user/, src/features/auth/
   关键词: user, account, profile
   
2. billing (置信度: 0.85)
   路径: src/modules/billing/
   关键词: billing, payment, invoice
   
3. analytics (置信度: 0.75)
   路径: src/modules/analytics/
   
是否确认这些业务域？[Y/n]

> y

✓ 配置已保存到 .autoimprove.json

你可以随时编辑配置文件来调整业务域设置。
```

### 发现新域

```
在会话中...

💡 检测到可能的新业务域：

  notification (置信度: 0.78)
  路径: src/modules/notification/
  关键词: notification, email
  
是否添加到配置？[y/N]

> y

✓ 已添加 notification 到业务域配置
```

### 配置过时提醒

```
⚠️  业务域配置可能已过时：

  - analytics: 配置的路径 src/modules/analytics/ 不存在
  - reporting: 发现新路径 src/modules/reporting/（可能是重命名？）
  
是否更新配置？[Y/n]

> y

建议的更新：
  1. 删除 analytics
  2. 添加 reporting
  
确认？[Y/n]

> y

✓ 配置已更新
```

## 总结

混合方案的核心：

1. **首次使用**：自动推断 + 用户确认
2. **日常使用**：配置优先，推断补充
3. **持续演进**：定期检查，提示更新

优点：
- 新项目开箱即用（自动推断）
- 用户可以精细控制（手动配置）
- 配置不会过时（持续更新）

实现复杂度：中等
用户体验：好
