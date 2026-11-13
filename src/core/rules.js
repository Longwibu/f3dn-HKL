import { DEMO_THREATS } from "../data/catalog.js";

export const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const exactHostRegex = (hostname) => `^https?://${escapeRegex(hostname)}(:[0-9]+)?/`;
export const temporaryRuleId = (tabId) => 1_000_000 + tabId;

export function buildProtectionRules(settings, blockedDomains, allowedDomains) {
  if (!settings.enabled || !settings.blockDangerous) return [];
  const rules = [...new Set([...DEMO_THREATS, ...blockedDomains])].map((domain, index) => ({
    id: index + 1, priority: 10, action: { type: "block" },
    condition: { requestDomains: [domain], resourceTypes: ["main_frame"] },
  }));
  for (const [index, domain] of allowedDomains.entries()) {
    rules.push({
      id: 100_000 + index, priority: 100, action: { type: "allow" },
      condition: { regexFilter: exactHostRegex(domain), resourceTypes: ["main_frame"] },
    });
  }
  return rules;
}

export function buildTemporaryRule(tabId, hostname) {
  return {
    id: temporaryRuleId(tabId), priority: 100, action: { type: "allow" },
    condition: { tabIds: [tabId], regexFilter: exactHostRegex(hostname), resourceTypes: ["main_frame"] },
  };
}
