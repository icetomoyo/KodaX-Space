export interface ProviderEditorState {
  readonly providerId: string;
  readonly formKey: string;
}

export const ADD_PROVIDER_FORM_KEY = 'add-provider';

export function beginProviderEdit(providerId: string): ProviderEditorState {
  return { providerId, formKey: `edit-provider:${providerId}` };
}

export function retargetProviderEdit(
  state: ProviderEditorState | null,
  providerId: string,
): ProviderEditorState | null {
  return state ? { ...state, providerId } : null;
}
