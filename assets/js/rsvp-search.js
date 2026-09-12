// Search keys are separate from the authoritative identity keys used by imports.
export function searchTokens(value) {
  return String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en").replace(/['’‘`ʼ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
}
export function meaningfulQuery(value) { return searchTokens(value).join("").length >= 2; }
export function matchesName(name, query) {
  const words = searchTokens(name), prefixes = searchTokens(query);
  if (!prefixes.length) return false;
  // Compound names can be joined/spaced; each name token is consumed only once.
  function match(index, used) {
    if (index === prefixes.length) return true;
    for (let start = 0; start < words.length; start++) {
      let joined = "", mask = used;
      for (let end = start; end < words.length; end++) {
        if (mask.has(end)) break;
        joined += words[end]; mask = new Set(mask).add(end);
        if (joined.startsWith(prefixes[index]) && match(index + 1, mask)) return true;
      }
    }
    return false;
  }
  return match(0, new Set());
}
export function suggestNames(names, query) {
  if (!meaningfulQuery(query)) return { names: [], hasMore: false };
  const matches = [...new Set(names)].filter(name => matchesName(name, query))
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }) || a.localeCompare(b));
  return { names: matches.slice(0, 8), hasMore: matches.length > 8 };
}
export function narrowsQuery(previous, next) {
  const before = searchTokens(previous), after = searchTokens(next);
  return before.length > 0 && before.length === after.length && before.every((token, i) => after[i].startsWith(token));
}
