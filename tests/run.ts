import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runTests } from "../test.mjs";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("astra-advisor-test", {
    description: "Run local Astra Advisor regression tests with mocked model boundaries; no inference.",
    handler: async () => {
      const passed = await runTests();
      pi.sendMessage({ customType: "astra-advisor-tests", content: `${passed.length} tests passed:\n${passed.map((name: string) => `- ${name}`).join("\n")}`, display: true });
    },
  });
}
