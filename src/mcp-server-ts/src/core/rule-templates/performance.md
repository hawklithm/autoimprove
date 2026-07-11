---
name: performance-template
pattern_type: performance
min_occurrences: 1
description: Template for generating rules from performance optimization patterns
---

# Performance Optimization Rule Template

This template generates rules from patterns where the user improves performance through specific optimizations.

## Phase 1: Extract Context [parallel]

Run `extract_file_context` as function_call with:
- session_id: `{{ pattern.session_id }}`
- file_paths: `{{ pattern.affected_files }}`

Save as `context_extraction`.

Run `extract_performance_metrics` as function_call with:
- pattern_data: `{{ pattern.raw_data }}`
- user_feedback: `{{ pattern.user_feedback }}`

Save as `performance_metrics`.

## Phase 2: Generate Rule Description [depends_on: [context_extraction, performance_metrics]]

Run `llm_generate_description` as llm_call with:
- context: `{{ outputs.context_extraction.content }}`
- metrics: `{{ outputs.performance_metrics.summary }}`
- pattern_type: `{{ pattern.type }}`
- prompt_template: |
    You are analyzing a performance optimization to generate a reusable performance rule.
    
    ## Performance Issue
    {{ outputs.performance_metrics.summary }}
    
    ## Context
    Files: {{ outputs.context_extraction.files }}
    Technology: {{ outputs.context_extraction.tech_stack }}
    
    ## Metrics (if available)
    Before: {{ outputs.performance_metrics.before }}
    After: {{ outputs.performance_metrics.after }}
    Improvement: {{ outputs.performance_metrics.improvement }}
    
    ## Your Task
    Generate a structured performance optimization rule:
    
    ### Description
    One-line summary of the performance optimization (max 120 chars).
    
    ### Rationale
    Explain the performance problem:
    - What was slow/inefficient and why
    - The bottleneck or root cause
    - Performance impact (time, memory, CPU, I/O)
    
    ### How to Apply
    Step-by-step optimization instructions:
    - How to identify this performance issue
    - Specific refactoring steps
    - What to measure to verify improvement
    
    ### When to Use
    Scenarios where this optimization applies:
    - Data size thresholds (e.g., ">1000 items")
    - Frequency of operation (e.g., "called in loops")
    - Context where performance matters
    
    ### Trade-offs
    Any downsides to this optimization:
    - Code complexity increase
    - Memory vs speed trade-offs
    - Maintenance considerations

Save as `rule_description`.

## Phase 3: Extract Code Examples [depends_on: [performance_metrics]]

Run `extract_code_before_after` as function_call with:
- pattern_data: `{{ outputs.performance_metrics.code_snippets }}`
- max_examples: 2
- include_context: true
- annotate_changes: true

Save as `code_examples`.

## Phase 4: Detect Scene Context [depends_on: [context_extraction]]

Run `detect_scene_from_files` as function_call with:
- file_paths: `{{ outputs.context_extraction.files }}`
- user_messages: `{{ pattern.user_messages }}`
- functional_hints: ["performance", "optimization"]

Save as `scene_detection`.

## Phase 5: Assemble Final Rule [depends_on: [rule_description, code_examples, scene_detection]]

Run `assemble_rule_markdown` as function_call with:
- rule_id: `{{ pattern.rule_id }}`
- description: `{{ outputs.rule_description.description }}`
- rationale: `{{ outputs.rule_description.rationale }}`
- how_to_apply: `{{ outputs.rule_description.how_to_apply }}`
- when_to_use: `{{ outputs.rule_description.when_to_use }}`
- trade_offs: `{{ outputs.rule_description.trade_offs }}`
- code_examples: `{{ outputs.code_examples.examples }}`
- scenes: `{{ outputs.scene_detection.scenes }}`
- pattern_type: `{{ pattern.type }}`
- confidence: `{{ pattern.confidence }}`
- priority: high
- keywords: ["performance", "optimization", "{{ outputs.performance_metrics.optimization_type }}"]

Save as `final_rule`.
