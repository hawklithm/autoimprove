---
name: correction-pattern-template
pattern_type: repeated-correction
min_occurrences: 2
description: Template for generating rules from repeated user corrections
---

# Correction Pattern Rule Template

This template generates rules from patterns where the user repeatedly corrects the same type of mistake.

## Phase 1: Extract Context [parallel]

Run `extract_file_context` as function_call with:
- session_id: `{{ pattern.session_id }}`
- file_paths: `{{ pattern.affected_files }}`

Save as `context_extraction`.

Run `extract_user_corrections` as function_call with:
- pattern_data: `{{ pattern.raw_data }}`
- occurrences: `{{ pattern.occurrences }}`

Save as `correction_extraction`.

## Phase 2: Generate Rule Description [depends_on: [context_extraction, correction_extraction]]

Run `llm_generate_description` as llm_call with:
- context: `{{ outputs.context_extraction.content }}`
- corrections: `{{ outputs.correction_extraction.items }}`
- pattern_type: `{{ pattern.type }}`
- confidence: `{{ pattern.confidence }}`
- prompt_template: |
    You are analyzing repeated user corrections to generate a reusable coding rule.
    
    ## Context
    Files involved: {{ outputs.context_extraction.files }}
    Sessions: {{ outputs.context_extraction.session_count }}
    
    ## User Corrections
    {{ outputs.correction_extraction.summary }}
    
    ## Your Task
    Generate a structured rule in this format:
    
    ### Description
    One-line summary of what the rule addresses (max 120 chars).
    
    ### Rationale
    Why this pattern is problematic or why the correction is needed (2-3 sentences).
    Explain the technical reason or user preference behind this correction.
    
    ### How to Apply
    Step-by-step instructions for applying this rule (3-5 bullet points).
    Be specific and actionable. Include:
    - When to apply this rule (file types, contexts)
    - What to change (specific patterns to look for)
    - How to change it (concrete transformations)
    
    ### Exceptions
    When NOT to apply this rule (1-2 bullet points).
    Edge cases or contexts where this rule doesn't apply.
    
    ## Output Requirements
    - Be concise but complete
    - Use technical terminology appropriately
    - Focus on the "why" not just the "what"
    - Make it actionable for future sessions

Save as `rule_description`.

## Phase 3: Extract Code Examples [depends_on: [correction_extraction]]

Run `extract_code_before_after` as function_call with:
- corrections: `{{ outputs.correction_extraction.items }}`
- max_examples: 3
- include_context: true

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
- exceptions: `{{ outputs.rule_description.exceptions }}`
- code_examples: `{{ outputs.code_examples.examples }}`
- scenes: `{{ outputs.scene_detection.scenes }}`
- pattern_type: `{{ pattern.type }}`
- confidence: `{{ pattern.confidence }}`
- occurrences: `{{ pattern.occurrences }}`
- first_seen: `{{ pattern.first_seen }}`
- last_seen: `{{ pattern.last_seen }}`

Save as `final_rule`.
