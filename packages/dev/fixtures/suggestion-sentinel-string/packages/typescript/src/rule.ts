export const someRule = {
  create(context: { report: (v: { suggestion: string }) => void }) {
    context.report({ suggestion: "No suggestion available for this rule." });
  },
};
