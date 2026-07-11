---
name: anti-pattern-template
pattern_type: anti-pattern
min_occurrences: 1
description: Template for generating rules from identified anti-patterns or bad practices
---

# Anti-Pattern Rule Template

This template generates rules from patterns where the user identifies and fixes anti-patterns or bad coding practices.

## Phase 1: Extract Context [parallel]

Run `extract_file_context` as function_call with:
- session_id: `{{ pattern.session_id }}`
- file_paths: `{{ pattern.affected_files }}`

Save as `context_extraction`.

Run `extract_anti_pattern_details` as function_call with:
- pattern_data: `{{ pattern.raw_data }}`
- user_feedback: `{{ pattern.user_feedback }}`

Save as `anti_pattern_details`.

## Phase 2: Generate Rule Description [depends_on: [context_extraction, anti_pattern_details]]

Run `llm_generate_description` as llm_call with:
- context: `{{ outputs.context_extraction.content }}`
- anti_pattern: `{{ outputs.anti_pattern_details.summary }}`
- pattern_type: `{{ pattern.type }}`
- prompt_template: |
    You are analyzing an anti-pattern to generate a preventive coding rule.
    
    ## Anti-Pattern Identified
    {{ outputs.anti_pattern_details.summary }}
    
    ## Context
    Files: {{ outputs.context_extraction.files }}
    Technology: {{ outputs.context_extraction.tech_stack }}
    
    ## Your Task
    Generate a structured rule to prevent this anti-pattern:
    
    ### Description
    One-line summary of the anti-pattern to avoid (max 120 chars).
    
    ### Rationale
    Why this is an anti-pattern. Explain:
    - What problems it causes (performance, security, maintainability)
    - Why developers might make this mistake
    - The cost of this pattern (2-3 sentences)
    
    ### How to Apply
    Concrete steps to detect and fix this anti-pattern:
    - Symptoms to look for (code smells, patterns)
    - How to refactor away from this pattern
    - Better alternatives (with specific techniques)
    
    ### When to Use
    Scenarios where this rule applies (file types, contexts, frameworks).
    
    ### Exceptions
    Rare cases where this pattern might be acceptable (if any).

Save as `rule_description`.

## Phase 3: Extract Code Examples [depends_on: [anti_pattern_details]]

Run `extract_code_before_after` as function_call with:
- pattern_data: `{{ outputs.anti_pattern_details.code_snippets }}`
- max_examples: 2
- include_context: true
- highlight_anti_pattern: true

Save as `code_examples`.

## Phase 4: Detect Scene Context [depends_on: [context_extraction]]

Run `detect_scene_from_files` as function_call with:
- file_paths: `{{ outputs.context_extraction.files }}`
- user_messages: `{{ pattern.user_messages }}`

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
- severity: high
- keywords: `{{ outputs.anti_pattern_details.keywords }}`

Save as `final_rule`.
