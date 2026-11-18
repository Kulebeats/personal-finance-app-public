import { createRoot } from "react-dom/client";
import App from "./App";
import { installStaleChunkReloadHandler } from "./lib/chunkReload";
import "./index.css";

installStaleChunkReloadHandler();

createRoot(document.getElementById("root")!).render(<App />);
