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
  mutation.mutate({ recipient: 'alice' }, { onSuccess: (result, variables) => {
    const name: string = result;
    const recipient: string = variables.recipient;
    void [name, recipient];
    // @ts-expect-error success handlers preserve native result types
    const invalid: number = result;
    void invalid;
  } });
  // Success-handler results are ignored, including toast IDs and async values.
  mutation.mutate({ recipient: 'alice' }, { onSuccess: (result) => result.length });
  mutation.mutate({ recipient: 'alice' }, { onSuccess: async (result) => result.length });
  // @ts-expect-error callback variables follow the mutation input
  mutation.mutate({ recipient: 'alice' }, { onSuccess: (_result, variables: { recipient: number }) => {} });
  const noVariables = useEnboxMutation(async () => 42);
  const emptyInput: readonly void[] = noVariables.pendingVariables;
  const noInputIssued: Promise<number> = noVariables.run(undefined);
  void [pending, issued, emptyInput, noInputIssued];
  return null;
}

void MutationContracts;
