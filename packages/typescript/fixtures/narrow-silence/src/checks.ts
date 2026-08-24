export function numeric(x: number) {
  if (x > 5) {
    return x;
  }
  return 0;
}

export function str(s: string) {
  if (s === "admin") {
    return s;
  }
  return "";
}

export function long(arr: string[]) {
  if (arr.length > 5) {
    return arr;
  }
  return arr;
}
