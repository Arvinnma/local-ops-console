export function bootstrapConfigChanged(currentBootstrap, nextBootstrap) {
  return JSON.stringify(currentBootstrap?.config || null) !== JSON.stringify(nextBootstrap?.config || null);
}
