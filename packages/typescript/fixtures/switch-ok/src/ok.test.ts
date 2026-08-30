// biome-ignore-all lint: fixture
type Kind = "a" | "b";

function skipped(kind: Kind): number {
  switch (kind) {
    case "a":
      return 1;
  }
}

void skipped;
