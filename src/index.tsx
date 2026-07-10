import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  staticClasses,
} from "@decky/ui";
import {
  addEventListener,
  definePlugin,
  removeEventListener,
  toaster,
} from "@decky/api";
import { useEffect, useMemo, useState } from "react";
import { FaGamepad } from "react-icons/fa";
import {
  Action,
  Binding,
  Device,
  InputRef,
  Status,
  beginCalibration,
  createProfile,
  deleteBinding,
  finishCalibration,
  getStatus,
  refreshDevices,
  saveBinding,
  setEnabled,
  setProfile,
  startLearning,
} from "./api";

const fieldStyle = {
  width: "100%",
  padding: "8px",
  borderRadius: "4px",
  boxSizing: "border-box",
} as const;

function notifyError(error: unknown) {
  toaster.toast({ title: "Controller1", body: String(error) });
}

function Content() {
  const [status, setStatus] = useState<Status>();
  const [selectedDevice, setSelectedDevice] = useState("");
  const [learned, setLearned] = useState<InputRef[]>([]);
  const [actionType, setActionType] = useState<Action["type"]>("key");
  const [outputCode, setOutputCode] = useState("KEY_ESC");
  const [bindingName, setBindingName] = useState("");
  const [bindingLayer, setBindingLayer] = useState("base");
  const [rangeLow, setRangeLow] = useState(-1);
  const [rangeHigh, setRangeHigh] = useState(1);
  const [profileName, setProfileName] = useState("");
  const [calibrating, setCalibrating] = useState(false);

  const activeProfile = useMemo(
    () => status?.profiles.find((profile) => profile.id === status.activeProfileId),
    [status],
  );
  const activeDevice = useMemo(
    () => status?.devices.find((device) => device.id === selectedDevice),
    [selectedDevice, status],
  );

  useEffect(() => {
    if (activeProfile?.deviceId) {
      setSelectedDevice(activeProfile.deviceId);
    } else if (activeProfile && status?.enabled) {
      setSelectedDevice("");
    }
  }, [activeProfile?.deviceId, activeProfile?.id, status?.enabled]);

  useEffect(() => {
    getStatus().then((next) => {
      setStatus(next);
      const profile = next.profiles.find((item) => item.id === next.activeProfileId);
      setSelectedDevice(profile?.deviceId ?? next.devices[0]?.id ?? "");
    }).catch(notifyError);

    const statusListener = addEventListener<[Status]>("status_changed", setStatus);
    const devicesListener = addEventListener<[Device[]]>("devices_changed", (devices) => {
      setStatus((current) => current ? { ...current, devices } : current);
    });
    const learnedListener = addEventListener<[InputRef]>("learned_input", (input) => {
      setLearned((current) => current.some(
        (item) => item.eventType === input.eventType && item.code === input.code,
      ) ? current : [...current, input]);
    });
    return () => {
      removeEventListener("status_changed", statusListener);
      removeEventListener("devices_changed", devicesListener);
      removeEventListener("learned_input", learnedListener);
    };
  }, []);

  const reload = async () => {
    const next = await getStatus();
    setStatus(next);
  };

  const toggle = async () => {
    if (!status) return;
    try {
      setStatus(await setEnabled(!status.enabled, selectedDevice || undefined));
    } catch (error) {
      notifyError(error);
    }
  };

  const learnNext = async () => {
    try {
      await startLearning();
      toaster.toast({ title: "Controller1", body: "Move the input you want to bind." });
    } catch (error) {
      notifyError(error);
    }
  };

  const addBinding = async () => {
    if (!activeProfile || learned.length === 0) return;
    const continuous = actionType === "gamepadAxis" || actionType === "mouseMove";
    const conditionInputs = continuous ? learned.slice(1) : learned;
    const conditions = conditionInputs.map((input) => ({
      input,
      test: input.eventType === 1 ? "pressed" as const : "axisRange" as const,
      ...(input.eventType === 3 ? { axisRange: [rangeLow, rangeHigh] as [number, number] } : {}),
    }));
    const action: Action = {
      type: actionType,
      code: outputCode.trim(),
      ...(actionType === "keyCombo" ? {
        codes: outputCode.split("+").map((item) => item.trim()).filter(Boolean),
      } : {}),
      ...(continuous ? { source: learned[0] } : {}),
    };
    const binding: Binding = {
      name: bindingName.trim() || `${learned.map((item) => item.name).join(" + ")} → ${outputCode}`,
      layer: bindingLayer.trim() || "base",
      conditions,
      action,
    };
    try {
      await saveBinding(activeProfile.id, binding);
      setLearned([]);
      setBindingName("");
      await reload();
    } catch (error) {
      notifyError(error);
    }
  };

  const toggleCalibration = async () => {
    if (!activeProfile || !activeDevice) return;
    try {
      if (!calibrating) {
        const inputs = activeDevice.axes.map((axis) => ({
          eventType: 3,
          code: axis.code,
          name: axis.name,
        }));
        await beginCalibration(inputs);
        setCalibrating(true);
      } else {
        await finishCalibration(activeProfile.id);
        setCalibrating(false);
        await reload();
      }
    } catch (error) {
      notifyError(error);
    }
  };

  if (!status) {
    return <PanelSection title="Controller1"><PanelSectionRow>Loading…</PanelSectionRow></PanelSection>;
  }

  return (
    <>
      <PanelSection title="Controller">
        {status.dependencyError && <PanelSectionRow><div style={{ color: "#ff8080" }}>{status.dependencyError}</div></PanelSectionRow>}
        <PanelSectionRow>
          <label style={{ width: "100%" }}>
            Physical device
            <select
              style={fieldStyle}
              value={selectedDevice}
              disabled={status.enabled}
              onChange={(event) => setSelectedDevice(event.currentTarget.value)}
            >
              <option value="">Select a controller…</option>
              {status.devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name} ({device.vendor.toString(16).padStart(4, "0")}:{device.product.toString(16).padStart(4, "0")})
                </option>
              ))}
            </select>
          </label>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => refreshDevices().then(reload).catch(notifyError)}>
            Refresh devices
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={!selectedDevice || Boolean(status.dependencyError)} onClick={toggle}>
            {status.enabled ? "Disable Controller1" : "Enable Controller1"}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Profile">
        <PanelSectionRow>
          <select
            style={fieldStyle}
            value={status.activeProfileId}
            onChange={(event) => setProfile(event.currentTarget.value).then(setStatus).catch(notifyError)}
          >
            {status.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
        </PanelSectionRow>
        <PanelSectionRow>
          <input style={fieldStyle} value={profileName} placeholder="New profile name" onChange={(event) => setProfileName(event.currentTarget.value)} />
          <ButtonItem
            layout="below"
            disabled={!profileName.trim()}
            onClick={() => createProfile(profileName).then(() => { setProfileName(""); return reload(); }).catch(notifyError)}
          >
            Create profile
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Calibration">
        <PanelSectionRow>
          <div>{calibrating ? "Move every axis through its full range, then center all sticks." : "Calibration is stored in this profile and applied before mappings."}</div>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={!status.enabled || !activeDevice} onClick={toggleCalibration}>
            {calibrating ? "Save ranges and centers" : "Start calibration"}
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Add mapping">
        <PanelSectionRow>
          <ButtonItem layout="below" disabled={!status.enabled} onClick={learnNext}>
            {learned.length ? "Learn another chord input" : "Learn input"}
          </ButtonItem>
        </PanelSectionRow>
        {learned.length > 0 && (
          <>
            <PanelSectionRow><div>Input: {learned.map((item) => item.name).join(" + ")}</div></PanelSectionRow>
            <PanelSectionRow>
              <select style={fieldStyle} value={actionType} onChange={(event) => setActionType(event.currentTarget.value as Action["type"])}>
                <option value="key">Keyboard key</option>
                <option value="keyCombo">Keyboard shortcut</option>
                <option value="gamepadButton">Gamepad button</option>
                <option value="gamepadAxis">Gamepad axis</option>
                <option value="mouseButton">Mouse button</option>
                <option value="mouseMove">Mouse movement</option>
                <option value="layer">Hold layer</option>
              </select>
            </PanelSectionRow>
            <PanelSectionRow>
              <input style={fieldStyle} value={outputCode} onChange={(event) => setOutputCode(event.currentTarget.value)} placeholder="KEY_ESC, BTN_SOUTH, ABS_X, REL_X…" />
            </PanelSectionRow>
            <PanelSectionRow>
              <input
                style={fieldStyle}
                value={bindingLayer}
                onChange={(event) => setBindingLayer(event.currentTarget.value)}
                placeholder="Active layer (base by default)"
              />
            </PanelSectionRow>
            {learned.some((item) => item.eventType === 3) && actionType !== "gamepadAxis" && actionType !== "mouseMove" && (
              <PanelSectionRow>
                <label>Axis range {rangeLow.toFixed(2)} to {rangeHigh.toFixed(2)}</label>
                <input style={fieldStyle} type="range" min="-1" max="1" step="0.05" value={rangeLow} onChange={(event) => setRangeLow(Number(event.currentTarget.value))} />
                <input style={fieldStyle} type="range" min="-1" max="1" step="0.05" value={rangeHigh} onChange={(event) => setRangeHigh(Number(event.currentTarget.value))} />
              </PanelSectionRow>
            )}
            <PanelSectionRow>
              <input style={fieldStyle} value={bindingName} onChange={(event) => setBindingName(event.currentTarget.value)} placeholder="Mapping name (optional)" />
            </PanelSectionRow>
            <PanelSectionRow><ButtonItem layout="below" onClick={addBinding}>Save mapping</ButtonItem></PanelSectionRow>
          </>
        )}
      </PanelSection>

      <PanelSection title="Mappings">
        {activeProfile?.bindings.length === 0 && <PanelSectionRow>No mappings yet.</PanelSectionRow>}
        {activeProfile?.bindings.map((binding) => (
          <PanelSectionRow key={binding.id}>
            <div style={{ flex: 1 }}>{binding.name}</div>
            <ButtonItem
              layout="below"
              onClick={() => binding.id && deleteBinding(activeProfile.id, binding.id).then(reload).catch(notifyError)}
            >
              Delete
            </ButtonItem>
          </PanelSectionRow>
        ))}
      </PanelSection>
    </>
  );
}

export default definePlugin(() => ({
  name: "Controller1",
  titleView: <div className={staticClasses.Title}>Controller1</div>,
  content: <Content />,
  icon: <FaGamepad />,
}));
