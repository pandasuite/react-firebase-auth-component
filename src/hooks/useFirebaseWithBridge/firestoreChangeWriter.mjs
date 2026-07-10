import { FIELD_PATH_UPDATES } from './modifyDataAdapter.mjs';
import { toFirestoreValue } from './mutationSentinels.mjs';

export const createFirestoreChangeWriter = ({ FieldValue, FieldPath }) => {
  const submit = ({ docRef, plan }) => {
    const args = [];
    for (const [path, value] of Object.entries(plan.update)) {
      args.push(path, toFirestoreValue(value, FieldValue));
    }
    for (const { segments, value } of plan.update[FIELD_PATH_UPDATES] || []) {
      args.push(new FieldPath(...segments), toFirestoreValue(value, FieldValue));
    }

    if (args.length === 0) {
      return Promise.resolve();
    }

    return docRef.update(...args);
  };

  return { submit };
};
