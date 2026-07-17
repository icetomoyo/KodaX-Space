import { RightSidebarFrame, type RightSidebarWidthMode } from '../../shell/RightSidebarFrame.js';
import { ArtifactPanel } from './ArtifactPanel.js';

interface PartnerRightSidebarProps {
  readonly width?: number;
  readonly widthMode?: RightSidebarWidthMode;
  readonly onDefaultWidth?: () => void;
  readonly onHalfWidth?: () => void;
  readonly onMaxWidth?: () => void;
  readonly onClose?: () => void;
}

export function PartnerRightSidebar({
  width,
  widthMode,
  onDefaultWidth,
  onHalfWidth,
  onMaxWidth,
  onClose,
}: PartnerRightSidebarProps): JSX.Element {
  return (
    <RightSidebarFrame
      width={width}
      widthMode={widthMode}
      onDefaultWidth={onDefaultWidth}
      onHalfWidth={onHalfWidth}
      onMaxWidth={onMaxWidth}
      onClose={onClose}
      closeTestId="partner-artifact-panel-close"
      dockKind="partner-artifact-dock"
    >
      <ArtifactPanel />
    </RightSidebarFrame>
  );
}
