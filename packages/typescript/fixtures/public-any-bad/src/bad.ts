// biome-ignore-all lint: fixture
export function takesAny(x: any): void {
  void x;
}

export function returnsAny(): any {
  return 1;
}

export function returnsAnyArray(): any[] {
  return [];
}

export const value: any = 1;
export let list: any[] = [];
list = [];
export const coerced = 1 as any;
export const arrow = (x: any): void => {
  void x;
};
export function takesFunction(x: Function): void {
  void x;
}

export function returnsObject(): Object {
  return {};
}

export const boxed: Object = {};
export const asFn = (() => undefined) as Function;

export default function def(x: any): void {
  void x;
}
