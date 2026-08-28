// biome-ignore-all lint: fixture
type Foo = string;
const n = 1 as const;
const s = "x" as Foo;
const u = n as unknown;
void n;
void s;
void u;
