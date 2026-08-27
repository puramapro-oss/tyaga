import type { CapacitorConfig } from "@capacitor/cli";

/**
 * TYAGA — Capacitor 7 config (P7).
 *
 * Stratégie flotte (MOBILE.md §1) : web wrapping du site live
 * tyaga.purama.dev — AUCUNE réécriture native, ~95% des mises à jour
 * passent par le déploiement web Vercel. ios/ et android/ ne sont jamais
 * commit : régénérés en CI depuis ce fichier + resources/.
 * Bundle id : dev.purama.tyaga.
 *
 * Apple §3.1.1 : aucun prix/abonnement affiché dans les écrans iOS —
 * le paiement reste sur le web (Stripe Checkout, *.stripe.com autorisé).
 */

const config: CapacitorConfig = {
  appId: "dev.purama.tyaga",
  appName: "TYAGA",
  webDir: "public", // dummy — server.url prend le dessus (wrapping web live)
  server: {
    url: "https://tyaga.purama.dev",
    androidScheme: "https",
    iosScheme: "https",
    cleartext: false,
    allowNavigation: ["tyaga.purama.dev", "auth.purama.dev", "*.stripe.com"],
  },
  ios: {
    contentInset: "automatic",
    backgroundColor: "#0A0A0F",
    preferredContentMode: "mobile",
    scheme: "TYAGA",
    limitsNavigationsToAppBoundDomains: false,
  },
  android: {
    backgroundColor: "#0A0A0F",
    captureInput: true,
    webContentsDebuggingEnabled: false,
    allowMixedContent: false,
    overrideUserAgent: undefined,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#0A0A0F",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "dark",
      backgroundColor: "#0A0A0F",
      overlaysWebView: true,
    },
    Haptics: {},
    Preferences: {
      group: "dev.purama.tyaga.prefs",
    },
  },
};

export default config;
