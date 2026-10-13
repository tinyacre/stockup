import { expect } from 'bun:test';

export function expectError(run: () => unknown, name: string) {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).name).toBe(name);
}
