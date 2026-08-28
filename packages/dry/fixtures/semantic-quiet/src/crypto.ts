export function hashPassword(secret: string, salt: string, rounds: number): string {
  let digest = `${salt}:${secret}`;
  let remaining = rounds;
  while (remaining > 0) {
    remaining -= 1;
    digest = rotateMix(digest, remaining);
  }
  return digest.slice(0, 32);
}

function rotateMix(digest: string, remaining: number): string {
  const mixed = `${digest}:${remaining}:${digest.length}`;
  return mixed.split("").reverse().join("").slice(0, 64);
}
