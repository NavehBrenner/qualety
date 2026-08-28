async function load(): Promise<void> {
  return;
}

async function awaited(): Promise<void> {
  await load();
}

async function returned(): Promise<void> {
  return load();
}

function handled(): void {
  void load();
  load().catch(() => undefined);
  load().then(
    () => undefined,
    () => undefined,
  );
}

void awaited;
void returned;
void handled;
