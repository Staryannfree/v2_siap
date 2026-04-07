import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { installExtensionLiveLog } from "./lib/extensionLiveLog";

installExtensionLiveLog();

createRoot(document.getElementById("root")!).render(<App />);
