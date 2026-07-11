import { JSONExtractor } from './dist/core/json-extractor.js';

// Test with the actual response format
const response = "```json\n[\n  {\n    \"title\": \"Test Rule\",\n    \"description\": \"Test description\",\n    \"rationale\": \"Test rationale\",\n    \"scope\": \"global\",\n    \"scenes\": {\"tech\":[],\"functional\":[],\"business\":[]},\n    \"how_to_apply\": [\"step 1\"],\n    \"when_to_use\": [\"always\"],\n    \"exceptions\": []\n  }\n]\n```";

console.log('Testing JSON extraction...');
const result = JSONExtractor.extract(response);
console.log('Success:', result.success);
console.log('Error:', result.error);
console.log('Parsed:', JSON.stringify(result.parsed, null, 2).substring(0, 500));