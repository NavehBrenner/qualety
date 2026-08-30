// biome-ignore-all lint: fixture
async function load(): Promise<void> {
  return;
}

function onEvent(handler: () => void): void {
  handler();
}

function run(): void {
  onEvent(async () => {
    await load();
  });
  onEvent(load);
  let handler: () => void;
  handler = async () => {
    await load();
  };
  const assigned: () => void = async () => {
    await load();
  };
  const items = [1];
  items.forEach(async (n) => {
    await load();
    void n;
  });
  void handler;
  void assigned;
}

void run;
