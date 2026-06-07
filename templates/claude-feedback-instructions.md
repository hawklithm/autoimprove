## AutoImprove Rule Usage Feedback

When you use rules learned by AutoImprove, please actively record feedback to help improve rule quality.

### 📊 Feedback Recording Guide

#### 1️⃣ When Applying a Rule
When you give advice based on an AutoImprove rule and the user accepts it:

```typescript
mcp__autoimprove-core__record_feedback({
  rule_id: "RULE-XXX",
  feedback_type: "used",
  user_rating: 5,  // Optional: 1-5, based on user reaction
  context: "Brief description of application scenario"
})
```

**When to record as "used"**:
- ✅ You referenced rule content to give advice
- ✅ User accepted the rule-based suggestion
- ✅ Rule helped you make a decision

#### 2️⃣ When Ignoring a Rule
When a rule doesn't apply to current scenario:

```typescript
mcp__autoimprove-core__record_feedback({
  rule_id: "RULE-XXX",
  feedback_type: "ignored",
  context: "Explain why it doesn't apply"
})
```

**When to record as "ignored"**:
- ⚠️ Rule doesn't match current scenario
- ⚠️ Rule suggestion is outdated or inapplicable
- ⚠️ User explicitly indicates they don't need this rule

#### 3️⃣ When Correcting a Rule Suggestion
When you need to adjust or modify the rule's suggestion:

```typescript
mcp__autoimprove-core__record_feedback({
  rule_id: "RULE-XXX",
  feedback_type: "corrected",
  context: "Explain how it was corrected"
})
```

**When to record as "corrected"**:
- 🔧 Rule direction is correct but details need adjustment
- 🔧 User proposed a better implementation
- 🔧 Rule needs modification based on specific situation

#### 4️⃣ When Disabling a Rule
When a rule has serious issues (use cautiously):

```typescript
mcp__autoimprove-core__record_feedback({
  rule_id: "RULE-XXX",
  feedback_type: "disabled",
  context: "Explain the problem"
})
```

**When to record as "disabled"**:
- ❌ Rule caused incorrect advice
- ❌ Rule conflicts with best practices
- ❌ Rule needs to be removed

### 💡 Feedback Recording Best Practices

1. **Record Promptly**: Record immediately when applying or ignoring rules, don't wait until conversation ends
2. **Add Context**: The `context` field helps understand feedback background
3. **Rating Guidelines**:
   - 5 points: Rule is very helpful, fully applicable
   - 4 points: Rule is useful, mostly applicable
   - 3 points: Rule is okay, needs adjustment
   - 2 points: Rule has limited help
   - 1 point: Rule is not very applicable
4. **Batch Recording**: One conversation may apply multiple rules, record each separately

### 🔍 Auto-Recording When Querying Rules

**Note**: When you query rules via `search_knowledge`, the system will **automatically record** as "used". You don't need to manually call `record_feedback`.

If you're just viewing rules without intending to apply them, use:
```typescript
mcp__autoimprove-core__search_knowledge({
  scene_json: "...",
  skip_feedback: true  // Skip auto-recording
})
```

### 📈 Value of Feedback

Your feedback will be used for:
- 📊 **Statistical Analysis**: Identify most useful and rules needing improvement
- 🎯 **Rule Optimization**: Adjust rule priority and confidence
- 🔄 **Adaptive Learning**: Adjust rule matching algorithm based on feedback
- 🗑️ **Clean Invalid Rules**: Remove low-value or incorrect rules

### Example Dialogue

**User**: Help me add form validation
**Claude**: Based on AutoImprove learned rule RULE-010...
[After applying rule]
```typescript
mcp__autoimprove-core__record_feedback({
  rule_id: "RULE-010",
  feedback_type: "used",
  user_rating: 5,
  context: "form_validation:user_accepted"
})
```

---

**Important**: Feedback recording is optional and doesn't affect your normal work. But continuous feedback can significantly improve AutoImprove quality!
