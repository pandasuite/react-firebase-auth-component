// Shared unit-test doubles for the Firestore FieldPath/FieldValue contract
// used by the change writer and runtime tests.
export class FakeFieldPath {
  constructor(...segments) {
    this.segments = segments;
  }
}

export const FakeFieldValue = {
  increment: (n) => ({ real: 'increment', n }),
  delete: () => ({ real: 'delete' }),
  arrayUnion: (...values) => ({ real: 'arrayUnion', values }),
  arrayRemove: (...values) => ({ real: 'arrayRemove', values }),
};
