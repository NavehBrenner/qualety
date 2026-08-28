// biome-ignore-all lint: fixture
function emptyBare(): void {
  try {
    throw new Error("x");
  } catch {}
}

function emptyBound(): void {
  try {
    throw new Error("x");
  } catch (e) {}
}

function commentOnly(): void {
  try {
    throw new Error("x");
  } catch {
    // swallowed
  }
}

void emptyBare;
void emptyBound;
void commentOnly;
