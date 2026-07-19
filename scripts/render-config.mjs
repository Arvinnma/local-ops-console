import { loadCatalog, renderAll } from "../src/config.mjs";

const paths = renderAll(loadCatalog());
console.log(`Generated ${paths.processCompose}`);
console.log(`Generated ${paths.workerCompose}`);
console.log(`Generated ${paths.caddyfile}`);
