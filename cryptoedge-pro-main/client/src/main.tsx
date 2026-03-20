import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { AppProvider } from "./context/AppContext";
import { ConfirmProvider } from "./context/ConfirmContext";
import { ToastProvider } from "./components/shared/Toast";
import App from "./App";
import "./styles/global.css";

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <AppProvider>
            <ConfirmProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </ConfirmProvider>
          </AppProvider>
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
}
