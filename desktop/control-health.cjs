"use strict";

async function confirmControlHealth({
  probe,
  wait,
  onFirstFailure = () => {},
  confirmDelayMs = 400,
  confirmTimeoutMs = 2000
}) {
  const first = await probe();
  if (first.ok) return { ...first, confirmed: false };
  onFirstFailure(first);
  await wait(confirmDelayMs);
  const second = await probe(confirmTimeoutMs);
  if (second.ok) return { ...second, confirmed: true, firstError: first.error || "" };
  return {
    ...second,
    ok: false,
    confirmed: true,
    firstError: first.error || "",
    error: second.error || first.error || "控制面健康检查失败"
  };
}

module.exports = { confirmControlHealth };
