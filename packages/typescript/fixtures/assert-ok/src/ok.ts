// biome-ignore-all lint: fixture
type Foo = string;
const n = 1 as const;
const s = "x" as Foo;
const u = n as unknown;
const angledFoo = <Foo>n;
const angledUnknown = <unknown>n;
function id<T>(x: T): T {
  return x;
}
const typeArg = id<any>(1);
void n;
void s;
void u;
void angledFoo;
void angledUnknown;
void typeArg;
