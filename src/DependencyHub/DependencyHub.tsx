import * as SDK from "azure-devops-extension-sdk";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../components/App";
import { ThemeProvider } from "../utils/theme";
import "../styles/app.css";
import "../styles/dependency-mapper.css";

SDK.init()
  .then(() => SDK.ready())
  .then(() => {
    const container = document.getElementById("root");
    if (container) {
      createRoot(container).render(
        <ThemeProvider>
          <App />
        </ThemeProvider>
      );
    }
  })
  .catch((err) => {
    console.error("Failed to initialize Azure DevOps SDK:", err);
    const container = document.getElementById("root");
    if (!container) return;
    // React never mounted, so this is plain DOM. textContent throughout: the
    // failure text is untrusted and this is the one path with no React escaping.
    container.textContent = "";
    const message = document.createElement("p");
    message.textContent =
      "Repository Dependency Mapper could not connect to Azure DevOps. Refresh the page to try again.";
    const details = document.createElement("pre");
    details.className = "ax-diag__pre";
    details.textContent = err?.message ?? String(err);
    container.append(message, details);
  });
