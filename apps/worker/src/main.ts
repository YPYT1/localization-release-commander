import { DeterministicPlatformAdapter } from "./platform.js";
import { createReleaseWorkflow } from "./workflow.js";

const workflow = createReleaseWorkflow(new DeterministicPlatformAdapter());
console.info(JSON.stringify({ worker: "ready", workflow: typeof workflow.start === "function" }));
