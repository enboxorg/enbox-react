import type { Enbox } from '@enbox/browser';
import { useEnboxMutation } from '@enbox/react';

function MutationContracts() {
  const mutation = useEnboxMutation(async (_enbox: Enbox, variables: { recipient: string }) => variables.recipient, {
    scope: 'selected-page',
  });
  const pending: readonly { recipient: string }[] = mutation.pendingVariables;
  const issued: Promise<string> = mutation.run({ recipient: 'alice' });
  // @ts-expect-error Pending variables cannot be appended to the SDK snapshot.
  mutation.pendingVariables.push({ recipient: 'bob' });
  // @ts-expect-error Pending variables cannot be replaced in the SDK snapshot.
  mutation.pendingVariables[0] = { recipient: 'bob' };
  // @ts-expect-error Variables retain the operation's input type.
  mutation.run({ recipient: 123 });
  mutation.mutate({ recipient: 'alice' });
  // @ts-expect-error UI callbacks are not part of the native mutation API
  mutation.mutate({ recipient: 'alice' }, { onSuccess: () => {} });
  // @ts-expect-error awaited native operations do not take UI callbacks
  mutation.mutateAsync({ recipient: 'alice' }, { onSuccess: () => {} });
  const noVariables = useEnboxMutation(async () => 42);
  const emptyInput: readonly void[] = noVariables.pendingVariables;
  const noInputIssued: Promise<number> = noVariables.run(undefined);
  void [pending, issued, emptyInput, noInputIssued];
  return null;
}

void MutationContracts;
