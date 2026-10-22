// A change schema demands at least one field. Beside an always-present id, refine with the other fields only.
export const hasChanges = (changes: object) => Object.values(changes).some((v) => v !== undefined);
export const nothingToChange = { message: 'Provide at least one field to change' };
