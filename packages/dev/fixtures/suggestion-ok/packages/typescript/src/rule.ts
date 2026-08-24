export const someRule = {
  create(context: { report: (v: { suggestion: string }) => void }) {
    context.report({ suggestion: "Import this export from a test file." });
  },
};
