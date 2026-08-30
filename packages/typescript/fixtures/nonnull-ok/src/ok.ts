// biome-ignore-all lint: fixture
class Box {
  foo!: string;
}

function run(value: string | undefined): string {
  if (value === undefined) {
    return "";
  }
  return value;
}

void Box;
void run;
