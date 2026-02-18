import { useEffect } from "react";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import "./index.css";

// TON Connect manifest — must be hosted at a public URL in production.
// For dev, we use a placeholder.
const tonConnectManifestUrl =
  import.meta.env.VITE_TON_MANIFEST_URL ||
  "https://splitogram.pages.dev/tonconnect-manifest.json";

function App() {
  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (webApp) {
      webApp.ready();
      document.body.style.backgroundColor = webApp.backgroundColor;
      document.body.style.color =
        webApp.themeParams.text_color || "#000000";

      if (webApp.colorScheme === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  }, []);

  return (
    <TonConnectUIProvider manifestUrl={tonConnectManifestUrl}>
      <div className="min-h-screen p-4">
        <h1 className="text-2xl font-bold mb-4">Splitogram</h1>
        <p className="text-gray-600">
          Split expenses with friends. Settle up with USDT on TON.
        </p>
      </div>
    </TonConnectUIProvider>
  );
}

export default App;
