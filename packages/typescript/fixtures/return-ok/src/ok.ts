// biome-ignore-all lint: fixture
export function annotated(): number {
  return 1;
}

export const typed: () => number = () => 1;

export const arrow = (): number => 1;

export type Only = number;

export interface Iface {
  x: number;
}

export { annotated as renamed } from "./impl";

export const obj = {
  method() {
    return 1;
  },
};

export class Box {
  constructor() {}

  private hidden() {
    return 1;
  }

  protected prot() {
    return 1;
  }

  #priv() {
    return 1;
  }

  set value(v: number) {
    void v;
  }

  method(): number {
    return 1;
  }

  get value(): number {
    return 1;
  }
}

export default function def(): void {
  return;
}
