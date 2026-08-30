// biome-ignore-all lint: fixture
type Kind = "a" | "b";

function unionMissing(kind: Kind): number {
  switch (kind) {
    case "a":
      return 1;
  }
}

enum Color {
  Red = 0,
  Blue = 1,
}

function enumMissing(color: Color): number {
  switch (color) {
    case Color.Red:
      return 1;
  }
}

function bareDefault(kind: Kind): number {
  switch (kind) {
    case "a":
      return 1;
    default:
      return 0;
  }
}

void unionMissing;
void enumMissing;
void bareDefault;
