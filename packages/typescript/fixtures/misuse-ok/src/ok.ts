// biome-ignore-all lint: fixture
async function load(): Promise<void> {
  return;
}

function onPromise(handler: () => Promise<void>): void {
  void handler();
}

function run(): void {
  onPromise(async () => {
    await load();
  });
  onPromise(load);
  const items = [1];
  items.forEach((n) => {
    void load();
    void n;
  });
  items.map(async (n) => {
    await load();
    return n;
  });
}

void run;
