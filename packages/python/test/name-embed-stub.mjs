const DIMS = 4;
const PARAPHRASE = new Set(["force ceiling", "strength cap"]);

export default {
  id: "name-embed-stub",
  revision: "1",
  dims: DIMS,
  async embed(texts) {
    return texts.map(embedOne);
  },
};

function embedOne(text) {
  const vector = new Float32Array(DIMS);
  if (PARAPHRASE.has(text.toLowerCase())) {
    vector[0] = 1;
    return vector;
  }
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  vector[hash % DIMS] = 1;
  return vector;
}
