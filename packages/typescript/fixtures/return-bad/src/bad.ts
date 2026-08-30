// biome-ignore-all lint: fixture
export function bare() {
  return 1;
}

export const arrow = () => 1;

export class Box {
  method() {
    return 1;
  }

  get value() {
    return 1;
  }
}

export default function def() {
  return 1;
}
