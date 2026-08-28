async function load(): Promise<void> {
  return;
}

function run(): void {
  load();
  load().then(() => undefined);
  new Promise((resolve) => {
    resolve(undefined);
  });
}

void run;
