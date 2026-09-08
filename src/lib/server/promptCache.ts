import { createHash } from "node:crypto";

/** Routing hint only: never a response cache, authorization boundary or retry key. */
export function promptCacheFields(model:string, schemaName:string, schema:Record<string,unknown>, instructions:string, enabled=true) {
  if (!enabled || !/^gpt-5(?:[.-]|$)/.test(model)) return {};
  return {prompt_cache_key: createHash('sha256').update(JSON.stringify(['dk-cache-v1',model,schemaName,schema,instructions])).digest('hex')};
}
