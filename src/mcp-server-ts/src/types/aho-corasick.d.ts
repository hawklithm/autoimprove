/**
 * Type declarations for aho-corasick module
 */

declare module "aho-corasick" {
  export interface SearchResult {
    [0]: number; // end position
    [1]: string[]; // matched keywords
  }

  export default class AhoCorasick {
    constructor(keywords: string[]);
    search(text: string): SearchResult[];
  }
}
