const DIMS = 32;
const STOP = new Set([
  "function",
  "const",
  "let",
  "var",
  "return",
  "export",
  "default",
  "async",
  "await",
  "class",
  "this",
  "for",
  "of",
  "in",
  "if",
  "else",
  "while",
  "number",
  "string",
  "boolean",
  "readonly",
  "array",
  "def",
  "self",
  "true",
  "false",
  "none",
  "from",
  "import",
  "pass",
  "with",
]);

export default {
  id: "test-stub",
  revision: "1",
  dims: DIMS,
  async embed(texts) {
    return texts.map(embedOne);
  },
};

function embedOne(text) {
  const vector = new Float32Array(DIMS);
  const stripped = text
    .replace(/\b(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_][\w]*/g, "function")
    .replace(/\bclass\s+[A-Za-z_][\w]*/g, "class")
    .replace(/\b(?:async\s+)?def\s+[A-Za-z_][\w]*/g, "def");
  const tokens = stripped.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? [];
  for (const token of tokens) {
    if (STOP.has(token) || token.length < 3) {
      continue;
    }
    let hash = 0;
    for (let i = 0; i < token.length; i += 1) {
      hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
    }
    vector[hash % DIMS] += 1;
  }
  let norm = 0;
  for (const value of vector) {
    norm += value * value;
  }
  const scale = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIMS; i += 1) {
    vector[i] /= scale;
  }
  return vector;
}
