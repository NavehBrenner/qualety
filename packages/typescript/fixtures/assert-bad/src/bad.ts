// biome-ignore-all lint: fixture
const n = 1;
const erased = n as any;
const doubled = n as unknown as string;
void erased;
void doubled;
