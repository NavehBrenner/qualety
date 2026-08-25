const plugin = {
  name: "demo",
  rules: {
    bad: {
      meta: { docs: { description: "bare rule object" } },
      create() {},
    },
  },
};

export default plugin;
