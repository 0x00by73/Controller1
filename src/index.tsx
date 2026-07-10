import { staticClasses } from "@decky/ui";
import { definePlugin, routerHook } from "@decky/api";
import { FaGamepad } from "react-icons/fa";
import { CONTROLLER_ROUTE, ControllerApp, QuickPanel } from "./controller-ui";

export default definePlugin(() => {
  routerHook.addRoute(CONTROLLER_ROUTE, ControllerApp);

  return {
    name: "Controller1",
    titleView: <div className={staticClasses.Title}>Controller1</div>,
    content: <QuickPanel />,
    icon: <FaGamepad />,
    onDismount() {
      routerHook.removeRoute(CONTROLLER_ROUTE);
    },
  };
});
