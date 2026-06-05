// Global jest setup.
//
// expo-crypto's randomUUID() relies on a native module that is unimplemented in the jest
// environment, so it returns undefined there. Production code uses it for SwipeRecord.id, so
// without this mock every record would get an undefined id under test. Provide deterministic,
// unique ids so identity-based logic (remove/undo/merge) behaves like it does at runtime.
jest.mock('expo-crypto', () => {
  const actual = jest.requireActual('expo-crypto');
  let counter = 0;
  return {
    ...actual,
    randomUUID: (): string => `test-uuid-${++counter}`,
  };
});
