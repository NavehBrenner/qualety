// biome-ignore-all lint: fixture
function run(value: string | undefined, items: string[]): string {
  const fromValue = value!;
  const fromProp = { n: value }.n!;
  const fromIndex = items[0]!;
  return fromValue + fromProp + fromIndex;
}

void run;
