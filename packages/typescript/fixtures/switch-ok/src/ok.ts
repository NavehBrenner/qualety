// biome-ignore-all lint: fixture
type Kind = "a" | "b";

function allCases(kind: Kind): number {
  switch (kind) {
    case "a":
      return 1;
    case "b":
      return 2;
  }
}

function fallthrough(kind: Kind): number {
  switch (kind) {
    case "a":
    case "b":
      return 1;
  }
}

function neverDefault(kind: Kind): number {
  switch (kind) {
    case "a":
      return 1;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

enum Color {
  Red = 0,
  Blue = 1,
}

function enumAll(color: Color): number {
  switch (color) {
    case Color.Red:
      return 1;
    case Color.Blue:
      return 2;
  }
}

function wideString(value: string): number {
  switch (value) {
    case "a":
      return 1;
  }
  return 0;
}

void allCases;
void fallthrough;
void neverDefault;
void enumAll;
void wideString;
