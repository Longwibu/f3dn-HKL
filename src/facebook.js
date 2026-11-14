import { startFacebookFilter } from "./content/facebook-filter.js";

// Start before Facebook constructs its feed, rather than waiting for document_idle.
startFacebookFilter().catch((error) => console.warn("PhishGuard Facebook:", error.message));
