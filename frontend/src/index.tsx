/*
 * index.tsx: the app's starting point. It loads the styles, finds the
 * <div id="root"> in public/index.html, and shows the App component
 * inside it, with a clear error if the div is missing.
 */

import { createRoot } from "react-dom/client";
import App from "./app";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error('public/index.html is missing <div id="root">');

createRoot(rootElement).render(<App />);