// biome-ignore-all lint: fixture
function rethrow(): void {
  try {
    throw new Error("x");
  } catch {
    throw new Error("y");
  }
}

function earlyReturn(): void {
  try {
    throw new Error("x");
  } catch (e) {
    void e;
    return;
  }
}

function noop(): void {
  try {
    throw new Error("x");
  } catch {
    void 0;
  }
}

function loop(): void {
  for (const x of [1]) {
    try {
      if (x < 0) {
        throw new Error("x");
      }
    } catch {
      continue;
    }
    void x;
  }
}

void rethrow;
void earlyReturn;
void noop;
void loop;
