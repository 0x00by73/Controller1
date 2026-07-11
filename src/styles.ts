export const controllerStyles = `
.Controller1 {
  --c1-accent: #1a9fff;
  --c1-good: #59bf40;
  --c1-warn: #e5a84b;
  --c1-surface: rgba(255, 255, 255, 0.055);
  --c1-surface-strong: rgba(255, 255, 255, 0.09);
  color: #f5f5f5;
  height: 100%;
}

.Controller1 * {
  box-sizing: border-box;
}

.Controller1_Page {
  height: 100%;
  min-height: 0;
}

.Controller1_Content {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px 24px 40px;
}

.Controller1_Hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 20px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(26, 159, 255, 0.2), rgba(26, 159, 255, 0.04));
  border: 1px solid rgba(106, 189, 255, 0.3);
}

.Controller1_Title {
  margin: 0;
  font-size: 26px;
  line-height: 1.1;
}

.Controller1_Subtitle {
  margin-top: 7px;
  color: rgba(255, 255, 255, 0.68);
  font-size: 14px;
}

.Controller1_Grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.Controller1_Grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.Controller1_Card {
  min-width: 0;
  padding: 16px;
  border-radius: 8px;
  background: var(--c1-surface);
  border: 1px solid rgba(255, 255, 255, 0.09);
}

.Controller1_Card--active {
  border-color: rgba(26, 159, 255, 0.7);
  box-shadow: inset 0 0 0 1px rgba(26, 159, 255, 0.2);
}

.Controller1_Control {
  cursor: pointer;
  transition: background 100ms ease, border-color 100ms ease, box-shadow 100ms ease;
}

.Controller1_Control--focused {
  border-color: var(--c1-accent) !important;
  box-shadow: 0 0 0 2px var(--c1-accent), 0 0 14px rgba(26, 159, 255, 0.35) !important;
}

.Controller1_CardTitle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 6px;
}

.Controller1_Meta {
  color: rgba(255, 255, 255, 0.56);
  font-size: 12px;
  font-family: monospace;
}

.Controller1_Badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.09);
  color: rgba(255, 255, 255, 0.75);
  font-size: 12px;
  white-space: nowrap;
}

.Controller1_Badge--good {
  background: rgba(89, 191, 64, 0.18);
  color: #8fe07b;
}

.Controller1_Badge--warn {
  background: rgba(229, 168, 75, 0.18);
  color: #f0c57e;
}

.Controller1_SectionHeader {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.Controller1_SectionHeader h2 {
  margin: 0;
  font-size: 20px;
}

.Controller1_SectionHeader p {
  margin: 5px 0 0;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
}

.Controller1_AxisTrack {
  position: relative;
  height: 12px;
  margin: 14px 0 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.35);
}

.Controller1_AxisObserved {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: inherit;
  background: linear-gradient(90deg, #1675b9, var(--c1-accent));
}

.Controller1_AxisCenter {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: rgba(255, 255, 255, 0.3);
  transform: translateX(-1px);
}

.Controller1_AxisValue {
  position: absolute;
  top: -4px;
  width: 4px;
  height: 20px;
  border-radius: 3px;
  background: white;
  transform: translateX(-2px);
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
  transition: left 34ms linear;
  will-change: left;
}

.Controller1_AxisLabels {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  color: rgba(255, 255, 255, 0.55);
  font: 11px monospace;
}

.Controller1_ButtonGrid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.Controller1_ButtonChip {
  min-width: 0;
  padding: 10px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.09);
  transition: background 100ms ease, border-color 100ms ease, transform 100ms ease;
}

.Controller1_ButtonChip--pressed {
  background: rgba(26, 159, 255, 0.25);
  border-color: var(--c1-accent);
  transform: translateY(-1px);
}

.Controller1_ButtonChip--seen:not(.Controller1_ButtonChip--pressed) {
  border-color: rgba(89, 191, 64, 0.6);
}

.Controller1_ButtonName {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.Controller1_Progress {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.35);
}

.Controller1_ProgressFill {
  height: 100%;
  border-radius: inherit;
  background: var(--c1-accent);
  transition: width 160ms ease;
}

.Controller1_Actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.Controller1_Modal {
  display: flex;
  flex-direction: column;
  width: min(680px, calc(100vw - 56px));
  max-height: min(680px, calc(100vh - 120px));
  min-height: 0;
  overflow: hidden;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: #20242b;
  box-shadow: 0 20px 70px rgba(0, 0, 0, 0.55);
}

.Controller1_ModalFrame {
  max-width: calc(100vw - 32px) !important;
  max-height: calc(100vh - 48px) !important;
  overflow: hidden !important;
}

.Controller1_Modal > *,
.Controller1_ModalBody > *,
.Controller1_FormGrid > * {
  min-width: 0;
}

.Controller1_ModalHeader {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 13px;
  flex: none;
  padding: 16px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.09);
  background: linear-gradient(135deg, rgba(26, 159, 255, 0.13), rgba(26, 159, 255, 0.025));
}

.Controller1_ControlIcon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid rgba(90, 187, 255, 0.36);
  border-radius: 9px;
  background: rgba(26, 159, 255, 0.16);
  color: #70c3ff;
  font-size: 17px;
}

.Controller1_ModalTitle h2,
.Controller1_FormHeading h3 {
  margin: 0;
}

.Controller1_ModalTitle h2 {
  overflow: hidden;
  font-size: 20px;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.Controller1_ModalTitle p,
.Controller1_FormHeading p {
  margin: 4px 0 0;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  line-height: 1.35;
}

.Controller1_ModalBody {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
  gap: 16px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 16px 18px 20px;
}

.Controller1_MappingBuilder {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.045);
}

.Controller1_FormHeading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.Controller1_FormHeading h3 {
  font-size: 15px;
  line-height: 1.2;
}

.Controller1_FormHeading--compact {
  align-items: flex-start;
}

.Controller1_FormGrid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.Controller1_RangeEditor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 11px 12px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.2);
}

.Controller1_RangeValue {
  flex: none;
  color: #83cbff;
  font: 12px monospace;
  white-space: nowrap;
}

.Controller1_Actions--primary > :last-child {
  min-width: 150px;
}

.Controller1_Assigned {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.Controller1_ModalFooter {
  display: flex;
  flex: none;
  justify-content: flex-end;
  padding: 12px 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.09);
  background: rgba(0, 0, 0, 0.18);
}

.Controller1_Stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.Controller1_Chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  min-height: 42px;
  padding: 9px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.22);
}

.Controller1_Chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border-radius: 6px;
  background: rgba(26, 159, 255, 0.18);
  border: 1px solid rgba(26, 159, 255, 0.45);
  font-size: 13px;
}

.Controller1_Empty {
  padding: 24px;
  border: 1px dashed rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.58);
  text-align: center;
}

.Controller1_Empty--compact {
  padding: 15px;
}

.Controller1_MappingRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 7px;
  background: var(--c1-surface);
}

.Controller1_MappingRoute {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 9px;
  margin-top: 6px;
  color: rgba(255, 255, 255, 0.62);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.Controller1_Error {
  padding: 12px;
  border-radius: 7px;
  color: #ffb0b0;
  background: rgba(180, 40, 40, 0.22);
}

.Controller1_DebugReport {
  min-height: 360px;
  max-height: calc(100vh - 230px);
  margin: 0;
  overflow: auto;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.32);
  color: #d8e8f5;
  font: 12px/1.45 monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}

.Controller1_QAMStatus {
  padding: 12px;
  border-radius: 6px;
  background: var(--c1-surface);
}

.Controller1_Content--selecting {
  padding-bottom: 168px;
}

.Controller1_Section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.Controller1_Section--configured {
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.Controller1_Actions--inline {
  flex: none;
}

.Controller1_Card--compact {
  padding: 10px 12px;
}

.Controller1_ControlInventory {
  display: grid;
  gap: 10px;
}

.Controller1_InventoryCard {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: var(--c1-surface);
}

.Controller1_InventorySummary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
}

.Controller1_InventoryPosition {
  display: inline-flex;
  gap: 6px;
}

.Controller1_InventoryPosition strong {
  color: rgba(255, 255, 255, 0.88);
}

.Controller1_SelectionDock {
  position: sticky;
  bottom: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: auto;
  padding: 14px 16px 16px;
  border: 1px solid rgba(229, 168, 75, 0.45);
  border-radius: 10px 10px 0 0;
  background: linear-gradient(180deg, rgba(18, 22, 28, 0.96), rgba(10, 12, 16, 0.98));
  box-shadow: 0 -10px 28px rgba(0, 0, 0, 0.35);
}

.Controller1_SelectionDockHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.Controller1_Chips--dock {
  min-height: 36px;
}

.Controller1_Chip--dock {
  border-color: rgba(229, 168, 75, 0.45);
}

.Controller1_Actions--dock {
  justify-content: flex-end;
}

.Controller1_Actions--dock > :last-child {
  min-width: 150px;
}

.Controller1_PositionEditor {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.22);
}

.Controller1_PreviewTable {
  display: grid;
  gap: 8px;
}

.Controller1_PreviewRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1.2fr) auto;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
}

.Controller1_PreviewRow--active {
  border-color: rgba(90, 187, 255, 0.45);
}

.Controller1_PreviewRow--emitted {
  border-color: rgba(89, 191, 64, 0.55);
  background: rgba(89, 191, 64, 0.08);
}

.Controller1_PreviewCell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.Controller1_PreviewCell > span,
.Controller1_PreviewCell > small {
  color: rgba(255, 255, 255, 0.52);
  font-size: 11px;
}

.Controller1_PreviewCell > strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.Controller1_PreviewStatus {
  color: rgba(255, 255, 255, 0.62);
  font-size: 11px;
  text-align: right;
  white-space: nowrap;
}

.Controller1_Control--selected {
  border-color: rgba(89, 191, 64, 0.75) !important;
  box-shadow: inset 0 0 0 1px rgba(89, 191, 64, 0.35);
}

.Controller1_Control--grouped {
  border-color: rgba(90, 187, 255, 0.45);
}

.Controller1_ControlBadges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.Controller1_Badge--group {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: rgba(26, 159, 255, 0.18);
  border-color: rgba(90, 187, 255, 0.35);
}

.Controller1_GroupTag {
  margin-left: 8px;
  color: #70c3ff;
}

.Controller1_GroupTag--selected {
  color: #8fd86f;
}

.Controller1_SelectBanner {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-color: rgba(229, 168, 75, 0.45);
}

.Controller1_TypeOption {
  cursor: pointer;
}

.Controller1_TypeOption:focus,
.Controller1_TypeOption:hover {
  border-color: rgba(90, 187, 255, 0.55);
}

.Controller1_LogicalCard {
  display: flex;
  flex-direction: column;
  gap: 13px;
}

.Controller1_LogicalCard--binding {
  border-color: var(--c1-warn);
  box-shadow: inset 0 0 0 1px rgba(229, 168, 75, 0.25);
}

.Controller1_Positions {
  display: grid;
  gap: 9px;
}

.Controller1_PositionRow {
  display: grid;
  grid-template-columns: minmax(180px, 0.85fr) minmax(200px, 1.15fr);
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.2);
}

.Controller1_PositionOutput {
  color: rgba(255, 255, 255, 0.72);
  font-size: 13px;
}

.Controller1_ReviewNotice,
.Controller1_BindBanner {
  padding: 11px 12px;
  border-radius: 7px;
  background: rgba(229, 168, 75, 0.15);
  border: 1px solid rgba(229, 168, 75, 0.35);
  color: #f0c57e;
  font-size: 13px;
}

.Controller1_AdvancedDetails {
  display: grid;
  gap: 6px;
  padding: 11px 12px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.24);
  color: rgba(255, 255, 255, 0.58);
  font: 12px/1.45 monospace;
}

.Controller1_AdvancedDetails strong {
  color: rgba(255, 255, 255, 0.82);
  font-family: inherit;
}

.Controller1_Discovery {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
}

.Controller1_DiscoveryStep {
  display: flex;
  align-items: center;
  gap: 14px;
}

.Controller1_StepNumber {
  display: grid;
  flex: none;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--c1-accent);
  color: white;
  font-size: 17px;
  font-weight: 700;
}

.Controller1_PipelineRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: stretch;
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  background: var(--c1-surface);
}

.Controller1_PipelineRow--emitted {
  border-color: rgba(89, 191, 64, 0.55);
}

.Controller1_PipelineStage {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}

.Controller1_PipelineStage > span,
.Controller1_PipelineStage > small {
  overflow: hidden;
  color: rgba(255, 255, 255, 0.52);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.Controller1_PipelineStage > strong {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.Controller1_PipelineArrow {
  align-self: center;
  color: var(--c1-accent);
  font-size: 18px;
}

@media (max-width: 900px) {
  .Controller1_Grid--three {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .Controller1_Modal {
    width: calc(100vw - 32px);
    max-height: calc(100vh - 72px);
  }

  .Controller1_FormGrid {
    grid-template-columns: minmax(0, 1fr);
  }

  .Controller1_PositionRow,
  .Controller1_PipelineRow {
    grid-template-columns: minmax(0, 1fr);
  }

  .Controller1_PipelineArrow {
    transform: rotate(90deg);
    justify-self: center;
  }
}
`;
