/** Query failures are published in snapshots; awaited callers keep the original rejection. */
export function handledQuery<Result>(issued: Promise<Result>): Promise<Result> {
  void issued.catch(() => {});
  return issued;
}
