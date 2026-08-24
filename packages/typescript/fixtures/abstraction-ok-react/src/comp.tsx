function useFoo(): number {
  return 1;
}

function Widget() {
  return <div>{useFoo()}</div>;
}

export const el = Widget();
