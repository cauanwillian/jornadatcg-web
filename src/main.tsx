import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ShopProvider } from "./Shop";
import { takeRecoveryLink } from "./recovery-link";

const recovery = takeRecoveryLink(window.location, window.history);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ShopProvider recovery={recovery}>
      <App />
    </ShopProvider>
  </StrictMode>,
);
