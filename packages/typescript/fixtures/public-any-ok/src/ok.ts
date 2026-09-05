// biome-ignore-all lint: fixture
export function takesUnknown(x: unknown): void {
  void x;
}

export function returnsNum(): number {
  return 1;
}

export const value: unknown = 1;
export const list: number[] = [];
export const coerced = 1 as unknown;
export function takesObject(x: object): void {
  void x;
}
export const objects: Object[] = [];
function hiddenFn(x: Function): void {
  void x;
}
const hidden: any = 1;
void hidden;
void hiddenFn;

export { hidden };
