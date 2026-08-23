import { NO_SUGGESTION } from "qualety";

export const someRule = {
  create(context: { report: (v: { suggestion: string }) => void }) {
    context.report({ suggestion: NO_SUGGESTION });
  },
};
