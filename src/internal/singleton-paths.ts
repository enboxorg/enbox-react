import type { ProtocolDefinition, TypedEnbox } from '@enbox/browser';

/** The native set contract owns compile-time singleton eligibility. */
export type SingletonPaths<Definition extends ProtocolDefinition> =
  Parameters<TypedEnbox<Definition>['records']['set']>[0];

/** Require the same cardinality fact before observing an ID-free selection. */
export function isSingletonPath(definition: ProtocolDefinition, path: string): boolean {
  let rule: unknown = definition.structure;
  for (const segment of path.split('/')) {
    if (rule === null || typeof rule !== 'object' || !Object.hasOwn(rule, segment)) return false;
    rule = (rule as Record<string, unknown>)[segment];
  }
  if (rule === null || typeof rule !== 'object') return false;
  return (rule as { $recordLimit?: { max?: number } }).$recordLimit?.max === 1;
}
