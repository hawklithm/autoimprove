---
name: preference-template
pattern_type: preference
min_occurrences: 2
description: Template for generating rules from user coding preferences and style choices
---

# User Preference Rule Template

This template generates rules from patterns where the user consistently prefers certain coding styles or approaches.

## Phase 1: Extract Context [parallel]

Run `extract_file_context` as function_call with:
- session_id: `{{ pattern.session_id }}`
- file_paths: `{{ pattern.affected_files }}`

Save as `context_extraction`.

Run `extract_preference_patterns` as function_call with:
- pattern_data: `{{ pattern.raw_data }}`
- occurrences: `{{ pattern.occurrences }}`
- user_feedback: `{{ pattern.user_feedback }}`

Save as `preference_extraction`.

## Phase 2: Generate Rule Description [depends_on: [context_extraction, preference_extraction]]

Run `llm_generate_description` as llm_call with:
- context: `{{ outputs.context_extraction.content }}`
- preferences: `{{ outputs.preference_extraction.summary }}`
- pattern_type: `{{ pattern.type }}`
- prompt_template: |
    You are analyzing user coding preferences to generate a style rule.
    
    ## User Preference Pattern
    {{ outputs.preference_extraction.summary }}
    
    ## Context
    Files: {{ outputs.context_extraction.files }}
    Occurrences: {{ pattern.occurrences }}
    
    ## Your Task
    Generate a structured preference rule:
    
    ### Description
    One-line summary of the user's coding preference (max 120 chars).
    
    ### Rationale
    Why the user prefers this approach:
    - Personal style choice
    - Team convention alignment
    - Readability/maintainability reason
    - Consistency with existing codebase
    
    ### How to Apply
    Specific guidance for applying this preference:
    - What to look for (patterns to recognize)
    - How to apply the preferred style
    - Tools or settings that can enforce this (if any)
    
    ### When to Use
    Contexts where this preference applies:
    - File types or frameworks
    - Specific code constructs
    - Project-wide vs. local scope
    
    ### Exceptions
    Cases where the user accepts alternatives:
    - Third-party code conventions
    - Generated code
    - Specific contexts where flexibility is okay

Save as `rule_description`.

## Phase 3: Extract Code Examples [depends_on: [preference_extraction]]

Run `extract_code_before_after` as function_call with:
- pattern_data: `{{ outputs.preference_extraction.examples }}`
- max_examples: 3
- include_context: false
- show_alternatives: true

Save as `code_examples`.

## Phase 4: Detect Scene Context [depends_on: [context_extraction]]

Run `detect_scene_from_files` as function_call with:
- file_paths: `{{ outputs.context_extraction.files }}`
- user_messages: `{{ pattern.user_messages }}`
- functional_hints: ["style", "preference"]

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
- priority: medium
- category: style

Save as `final_rule`.
