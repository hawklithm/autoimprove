---
name: security-template
pattern_type: security
min_occurrences: 1
description: Template for generating rules from security-related corrections and improvements
---

# Security Rule Template

This template generates rules from patterns where the user identifies and fixes security vulnerabilities or improves security practices.

## Phase 1: Extract Context [parallel]

Run `extract_file_context` as function_call with:
- session_id: `{{ pattern.session_id }}`
- file_paths: `{{ pattern.affected_files }}`

Save as `context_extraction`.

Run `extract_security_issue` as function_call with:
- pattern_data: `{{ pattern.raw_data }}`
- user_feedback: `{{ pattern.user_feedback }}`

Save as `security_issue`.

## Phase 2: Generate Rule Description [depends_on: [context_extraction, security_issue]]

Run `llm_generate_description` as llm_call with:
- context: `{{ outputs.context_extraction.content }}`
- security_issue: `{{ outputs.security_issue.summary }}`
- pattern_type: `{{ pattern.type }}`
- prompt_template: |
    You are analyzing a security issue to generate a preventive security rule.
    
    ## Security Issue Identified
    {{ outputs.security_issue.summary }}
    
    ## Context
    Files: {{ outputs.context_extraction.files }}
    Technology: {{ outputs.context_extraction.tech_stack }}
    
    ## Your Task
    Generate a structured security rule:
    
    ### Description
    One-line summary of the security issue to prevent (max 120 chars).
    
    ### Rationale
    Explain the security risk:
    - What vulnerability or weakness this creates
    - Potential attack vectors or exploits
    - Impact if exploited (data breach, privilege escalation, etc.)
    - Severity level (critical, high, medium, low)
    
    ### How to Apply
    Concrete steps to fix and prevent this security issue:
    - How to identify vulnerable code patterns
    - Secure coding alternatives
    - Security best practices to follow
    - Validation or sanitization techniques
    
    ### When to Use
    Contexts where this rule is critical:
    - User input handling
    - Authentication/authorization code
    - Data storage and transmission
    - API endpoints
    - File operations
    
    ### Exceptions
    Rare cases where relaxed security might be acceptable (e.g., internal tools, test environments).
    Always explain the risk trade-off.

Save as `rule_description`.

## Phase 3: Extract Code Examples [depends_on: [security_issue]]

Run `extract_code_before_after` as function_call with:
- pattern_data: `{{ outputs.security_issue.code_snippets }}`
- max_examples: 2
- include_context: true
- highlight_vulnerability: true

Save as `code_examples`.

## Phase 4: Detect Scene Context [depends_on: [context_extraction]]

Run `detect_scene_from_files` as function_call with:
- file_paths: `{{ outputs.context_extraction.files }}`
- user_messages: `{{ pattern.user_messages }}`
- functional_hints: ["security", "authentication", "validation"]

Save as `scene_detection`.

## Phase 5: Assemble Final Rule [depends_on: [rule_description, code_examples, scene_detection]]

Run `assemble_rule_markdown` as function_call with:
- rule_id: `{{ pattern.rule_id }}`
- description: `{{ outputs.rule_description.description }}`
- rationale: `{{ outputs.rule_description.rationale }}`
- how_to_apply: `{{ outputs.rule_description.how_to_apply }}`
- when_to_use: `{{ outputs.rule_description.when_to_use }}`
- exceptions: `{{ outputs.rule_description.exceptions }}`
- code_examples: `{{ outputs.code_examples.examples }}`
- scenes: `{{ outputs.scene_detection.scenes }}`
- pattern_type: `{{ pattern.type }}`
- confidence: `{{ pattern.confidence }}`
- priority: critical
- severity: `{{ outputs.security_issue.severity }}`
- keywords: ["security", "{{ outputs.security_issue.vulnerability_type }}"]

Save as `final_rule`.
