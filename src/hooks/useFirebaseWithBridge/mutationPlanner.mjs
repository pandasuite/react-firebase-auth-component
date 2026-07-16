import {
  buildClassifiedUserDocUpdate,
  parsePointerObjects,
} from './modifyDataAdapter.mjs';
import { applyUpdateToDoc, plannerFieldValue } from './mutationSentinels.mjs';

export const planChange = ({
  JSONPointer,
  ModifyData,
  modify,
  userDoc,
  language,
}) => {
  if (
    !modify ||
    typeof modify !== 'object' ||
    modify.property == null ||
    (modify.func != null && typeof modify.func !== 'string')
  ) {
    return { kind: 'invalid', reason: 'change/malformed-action' };
  }

  const pointerObjects = parsePointerObjects({
    JSONPointer,
    property: modify.property,
  });
  if (pointerObjects.length === 0) {
    return { kind: 'invalid', reason: 'change/invalid-pointer' };
  }

  const baseDoc = userDoc && typeof userDoc === 'object' ? userDoc : {};

  // buildClassifiedUserDocUpdate never mutates userData (guarded by the
  // "planner purity" test), so the long-lived planning doc is passed as is.
  const classified = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: baseDoc,
    modify,
    FieldValue: plannerFieldValue,
    language,
    pointerObjects,
  });

  if (!classified) {
    return { kind: 'noop' };
  }

  const expectedDoc = applyUpdateToDoc({
    doc: baseDoc,
    update: classified.update,
  });

  return { kind: classified.category, update: classified.update, expectedDoc };
};
