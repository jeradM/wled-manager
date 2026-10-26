import { createMockWled } from "./mock.js";

// Start one or more mock devices: MOCK_PORTS=8081,8082 pnpm mock
const ports = (process.env.MOCK_PORTS ?? "8081").split(",").map(Number);

for (const [i, port] of ports.entries()) {
  const { app } = createMockWled({ name: `Mock WLED ${i + 1}`, ledCount: 60 + i * 30 });
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`mock WLED ${i + 1} on http://localhost:${port}`);
}
