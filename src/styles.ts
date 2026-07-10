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
  gap: 16px;
  width: min(720px, 80vw);
  max-height: 80vh;
  overflow-y: auto;
  padding: 20px;
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
  gap: 9px;
  margin-top: 6px;
  color: rgba(255, 255, 255, 0.62);
  font-size: 12px;
}

.Controller1_Error {
  padding: 12px;
  border-radius: 7px;
  color: #ffb0b0;
  background: rgba(180, 40, 40, 0.22);
}

.Controller1_QAMStatus {
  padding: 12px;
  border-radius: 6px;
  background: var(--c1-surface);
}

@media (max-width: 900px) {
  .Controller1_Grid--three {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
`;
