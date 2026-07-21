export interface PartnerProjectFileActivationActions {
  readonly selectFile: (path: string) => void;
  readonly openFile: (path: string) => void;
}

/** A Partner file click both selects the source target and opens the project-file preview. */
export function activatePartnerProjectFile(
  path: string,
  actions: PartnerProjectFileActivationActions,
): void {
  actions.selectFile(path);
  actions.openFile(path);
}
